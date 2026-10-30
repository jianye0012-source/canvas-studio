# Studio Agent bench

`test/qa-agent-bench-browser.mjs` measures how the real-model Studio Agent handles five fixed scene-authoring requests (#714). It runs in one browser session per model, writes one row per model x scenario, and merges the rows into a single JSON file, so later changes can be compared against a stored baseline. It uses a real model and a live scene, so it is not part of the default `node tools/run-tests.mjs` manifest.

## Running it

Start the full dev stack (Vite, the live hub and the `/agent/*` sidecar). The shell must export the provider credentials (for cliproxy: `CLIPROXY_API_KEY` and `CLIPROXY_BASE_URL`):

```sh
COZYCLAY_LIVE_PORT=6014 npm run dev -- --port 5194
```

Check that `GET http://127.0.0.1:5194/agent/providers` reports the provider with `signedIn: true`. Then run one process per model. Each process opens a fresh headless Chrome profile with a project named "QA", so the agent sessions stay separate:

```sh
for model in cliproxy/claude-opus-5-5 cliproxy/claude-sonnet-5-5; do
  COZYCLAY_LIVE_PORT=6014 QA_URL=http://127.0.0.1:5194/app/ CDP_PORT=9314 \
  QA_AGENT_MODEL=$model QA_OUT=/tmp/cozyclay-agent-bench QA_BENCH_LABEL=baseline \
  node tools/qa-browser.mjs -- node test/qa-agent-bench-browser.mjs
done
```

| Variable | Default | Meaning |
| --- | --- | --- |
| `QA_AGENT_MODEL` | `cliproxy/claude-opus-5-5` | Value selected in the Agent pane's Model select |
| `QA_AGENT_EFFORT` | unset | Value selected in the pane's "Reasoning effort" select (e.g. `medium`); unset keeps the pane default, which sends no effort field (thinking off). Recorded per row as `effort`. |
| `QA_OUT` | `/tmp/cozyclay-agent-bench` | Output directory |
| `QA_BENCH_LABEL` | `baseline` | Report name: writes `$QA_OUT/<label>.json` and `$QA_OUT/<label>/*.png` |
| `QA_BENCH_TURN_TIMEOUT_MS` | `480000` | Per-turn deadline |
| `COZYCLAY_LIVE_PORT` | `5184` | Live hub port, used by the `cclay live` reads |

Each run replaces that model's rows in `<label>.json` and keeps the other models' rows. The process exits 0 even when scenarios fail: a failed row is data. A row is missing only if the process crashed.

## Scenarios

The scenarios run in order in one session. The scene at page load has one character, no objects and no shots. S4 relies on S3 having just run.

| Id | Prompt | Success when |
| --- | --- | --- |
| S1 | 선택된 캐릭터 왼쪽 1.4m에 의자 하나 놔줘 | Object count is exactly one higher, and the new object's XZ distance to the selected character is in [1.0, 2.0] m |
| S2 | 그 캐릭터 주위에 의자 6개를 반경 2m 원형으로 둘러 배치해 | Exactly six chair objects sit in [1.5, 2.5] m (XZ) from the character after the turn (created or moved there - reusing the S1 chair is a valid reading) and the minimum pairwise XZ distance among them is > 0.3 m |
| S3 | 두 캐릭터가 테이블에 마주 앉아 대화하는 장면을 만들어. 캐릭터가 하나면 하나 추가해. 샷은 세 개: 마스터 투샷, A의 OTS, B의 OTS. | At least 2 characters, exactly 3 shots, and an object whose name, `libraryKind` or `renderer` contains "table" (built-in props such as the table carry no `libraryKind`; their kind is the `renderer` id) |
| S4 | 방금 한 거 되돌려 | S3 itself succeeded, and compared with the state right after S3 there are fewer than 3 shots or fewer objects. If S3 did not succeed, the revert cannot be observed: `success` is false and `errorCode` is `PRECONDITION_S3` |
| S5 | 두 캐릭터를 1.2m 간격으로 마주보게 세우고 미디엄 투샷으로 프레임 잡아 | At least 2 characters; the first two in document order are within [1.0, 1.4] m (XZ) and `(rotA - rotB) mod 360` is in [155, 205] degrees; the shot at the current frame (or the first shot) has a camera |

Scene facts are read through `cclay live describe` (positions, `rot`, shots) and `cclay live inspect --scope entities` (object `libraryKind`, set only for library assets) after each turn. The selected character is `activeCharacterId` before the turn.

## Metrics

The harness installs a `fetch` wrapper with `Page.addScriptToEvaluateOnNewDocument` before the Studio loads. That timing matters because the agent client binds `fetch` when it creates its transport. The wrapper clones every response whose URL contains `/agent/turn`, which covers the turn stream and a replay after a dropped stream. It parses the clone's `data: {json}` SSE lines, drops frames whose `eventSeq` it has already seen, and pushes the rest to `window.__benchFrames`, stamped with `receivedAt`. It also keeps each `/agent/turn` request body. Both are written to `$QA_OUT/<label>/<model-slug>-S<n>.turn.json` as `{ requests, frames }`, so a failing turn can be replayed with curl (see Known failures).

| Field | Definition |
| --- | --- |
| `toolCalls` | Number of `tool.start` frames |
| `authoredReceipts` | Number of `tool.done` frames with `result.authored === true` (stands in for history entries) |
| `wallMs` | `receivedAt` of the `done` frame minus `Date.now()` taken just before the Enter keydown; `null` if no `done` arrived |
| `overlapWarnings` | Total number of `warnings[]` entries with code `FOOTPRINT_OVERLAP` at any depth of the `tool.done` results |
| `errorCode` | `code` of the first `error` frame, `BENCH_TIMEOUT` when no `done` arrived within the turn deadline (the harness then presses Stop), `BENCH_SETUP` when the page or model could not be prepared, `BENCH_ERROR` for a harness or live-read failure, `PRECONDITION_S3` on an S4 row whose S3 did not succeed (the turn's own code moves to `measured.precondition.turnErrorCode`); otherwise `null` |
| `errorMessage` | `message` of the first `error` frame (as the sidecar sent it, which may already be truncated), the timeout or harness message, or `null` |
| `errorStatus` | `status` of the first `error` frame, or `null` (the sidecar omits it for upstream provider errors) |
| `usage` | The `done` frame's `usage` object, or `null` when the sidecar sends none |
| `success` | The scenario assertion above holds and `errorCode` is `null`. A turn that timed out or ended on an `error` frame did not do the work |
| `reply` | Final assistant text in the pane |
| `measured` | The values the assertion read (counts, distances, yaws, new object rows) |
| `turnLog` | Path of the turn's `{ requests, frames }` capture |

Each scenario also saves a viewport screenshot to `$QA_OUT/<label>/<model-slug>-S<n>.png`. The slug is the model id with every run of characters outside `[A-Za-z0-9.]` replaced by `-`.

## JSON schema

```jsonc
{
  "label": "baseline",           // QA_BENCH_LABEL
  "commit": "4f93c20",           // newest commit touching anything but the two bench files (the code under test)
  "createdAt": "ISO-8601",       // time of the last merge
  "rows": [                      // sorted by model, then scenario
    {
      "model": "cliproxy/claude-opus-5-5",
      "scenario": "S1",          // S1..S5
      "prompt": "...",
      "toolCalls": 0,
      "authoredReceipts": 0,
      "wallMs": 0,               // number | null
      "overlapWarnings": 0,
      "success": false,
      "errorCode": null,         // string | null
      "errorMessage": null,      // string | null
      "errorStatus": null,       // number | null
      "usage": null,             // object | null
      "reply": "",
      "measured": {},            // scenario-specific, or { "error": "..." }
      "turnLog": "/tmp/cozyclay-agent-bench/baseline/<model-slug>-S1.turn.json",
      "screenshot": "/tmp/cozyclay-agent-bench/baseline/<model-slug>-S1.png"
    }
  ]
}
```

## Known failures

### `cliproxy/claude-sonnet-5-5`: every turn fails with `upstream` (main 4f93c20)

All five sonnet rows in the baseline end within about 0.5 s with no tool calls, `errorCode: "upstream"` and `errorStatus: null`. The S4 row reads `PRECONDITION_S3` instead, with `turnErrorCode: "upstream"`. This document only records the failure; the sidecar fix is tracked separately.

Raw SSE frames of the page's own turn (`baseline/cliproxy-claude-sonnet-5-5-S1.turn.json`):

```
data: {"type":"error","code":"upstream","message":"400 {\"type\":\"error\",\"error\":{\"type\":\"invalid_request_error\",\"message\":\"To turn thinking off on this model, send \\\"thinking\\\": {\\\"type\\\": \\\"between_tools\\\"} instead of {\\\"type\\\": \\\"disabled\\\"}. The mo…","eventSeq":1}
data: {"type":"execution_telemetry","event":"agent:turn_failed","props":{"turn_id":"…","duration_bucket":"lt1s","failure_code":"upstream"}}
data: {"type":"done","eventSeq":2}
```

The sidecar cuts the message off at "The mo…". The full upstream message, from CLIProxyAPI's `/v1/messages` with `"thinking":{"type":"disabled"}`, returns HTTP 400:

```
claude-sonnet-5-5: To turn thinking off on this model, send "thinking": {"type": "between_tools"} instead of {"type": "disabled"}. The model does not think before responding. The short updates it writes between tool calls come back as thinking blocks.
claude-opus-5-5:   "thinking.type.disabled" is not supported for this model. Use "thinking.type.adaptive" and "output_config.effort" to control thinking behavior.
```

**The envelope the panel sends.** I captured the page's own `/agent/turn` POST with the CDP `Fetch` domain and aborted it before it reached the sidecar. Its keys are `surface, sessionId, turnId, text, context, model, attachFrame`. There is **no `effort` field**, even though `/agent/models` gives the model `defaultEffort: "medium"`.

**Replay with curl.** `curl -N -X POST http://127.0.0.1:5194/agent/turn -H 'Origin: http://127.0.0.1:5194' -H 'content-type: application/json' --data-binary @envelope.json`. The variants use the same envelope with new `sessionId`/`turnId` and the read-only text "씬에 오브젝트가 몇 개야? 숫자만 답해.":

| Envelope | Result |
| --- | --- |
| exact page envelope (sonnet, no `effort`) | HTTP 200, frames `error` (`upstream`, message above), `execution_telemetry`, `done` |
| sonnet, `effort: "none"` | same `upstream` 400 error |
| sonnet, `effort: "medium"` | `text.delta` "0", `done`: succeeds |
| opus, no `effort` | `text.delta` "0", `done`: succeeds |

Replaying a stale envelope, or rebuilding `context` from `cclay live inspect`, is refused before the model runs (409 `STALE_SCENE` / `STALE_TARGET`). The replay therefore needs the live page's own envelope.

**`GET /agent/models` (cliproxy).** The two entries differ only in whether `none` is allowed:

```
{"id":"claude-sonnet-5-5","efforts":["none","minimal","low","medium","high","xhigh","max"],"defaultEffort":"medium","input":["text","image"]}
{"id":"claude-opus-5-5",  "efforts":["minimal","low","medium","high","xhigh","max"],"defaultEffort":"medium","input":["text","image"]}
```

**Dev server log.** `npm run dev` stdout and stderr were captured to a file: 58 lines in total, none of them about `/agent/turn`. The sidecar does not log upstream turn failures, so the error frame is the only evidence.

**Reading.** With the effort omitted or `none`, the request ends up with thinking turned off. pi-ai's `anthropic-messages` sends `thinking: {type: "disabled"}` whenever thinking is off and the model's catalogue allows an "off" level. Sonnet-5-5 allows `none`, so it gets `disabled` and rejects it. Opus-5-5 has no `none`, so it never receives `disabled`, even though it would reject it too.

## Interaction scenarios (S6-S10)

S1-S5 above place things and frame shots. S6-S10 measure whether the agent's motion does what a one-line request means when a person acts on an object: the cause, the contact, the effect and what must not happen. Every scenario opens a pre-built scene (`test/fixtures/bench/<id>.cozyclay.json`, built by `test/bench/motion-fixtures.mjs`): one Y Bot at the origin facing +Z, and the set pieces with fixed ids 1-3 m ahead, so the agent walks to them. The request is the one line a user would type; nothing in it gives frames or order.

The assertions are ours, written per scenario in `test/bench/motion-scenarios.mjs`, each tagged **cause**, **contact**, **effect** or **negative**. They are timing-agnostic: the events are found in the take (the first fingertip on a button, the first frame an object moves), never assumed. They are measured by code from the installed take: the document's spec is compiled again in Node with the document's objects (`compileSpec`, `motionScene`) and read through the paths goals and probes read (`object-pose.js objectBoxesAt`, `landmark:mouth`, `sdBox`, `solePoints`; `test/bench/motion-track.mjs`). No model opinion enters a metric. Distances are to the object's oriented boxes (negative inside).

| Id | Request | Set (ids) | Assertions |
| --- | --- | --- | --- |
| S6 | 자판기 버튼을 눌렀는데 음료가 안 나와서 발로 한 번 차니까 캔이 떨어졌어. 캔 꺼내서 마셔줘 | `vending` (body, window, panel, `vm-button-1..3`, `vm-kick-panel`, `vm-tray`, `vm-opening`), `can` inside the body above the tray | cause: a fingertip within 3 cm of a button (f_press) · contact: after it, a raised sole point (0.15-0.7 m) within 3 cm of the machine front (f_kick) · negative: no hand or sole point deeper than 2 cm into the machine · negative: the can stays within 1 cm until f_kick · effect: the can moves within 48 frames after f_kick · contact: after it moved, the can stays within 6 cm of a palm for 12+ frames · contact: the can top within 5 cm of the mouth · negative: the machine base never moves more than 2 cm |
| S7 | 문을 손으로 밀어서 열고 들어가줘 | `wall` (`wall-left`, `wall-right`, `wall-top`), `door` in the doorway (not hinged: the agent hinges it) | cause: a hand within 3 cm of the door (f_touch) · negative: the door does not move before f_touch · effect: after f_touch the door turns 60 degrees or more · effect: the hips end 10 cm past the wall's far face · negative: no hand, sole, hips, chest or head point deeper than 2 cm into wall or door · negative: the wall never moves |
| S8 | 테이블 위 컵을 들어서 한 모금 마시고 다시 내려놔 | `table` (`table-top`, 4 legs), `cup` on it | contact: a hand within 4 cm of the cup when it first moves · negative: the cup does not move before a hand reaches it · effect: the cup base rises 10 cm or more above the table · contact: the cup top within 5 cm of the mouth · effect: the cup moved and ends resting on the table top (-0.5..+1 cm, over it) · negative: the cup never more than 1 cm into the table · negative: no hand point deeper than 2 cm into the table |
| S9 | 의자에 가서 앉아줘 | `chair` (`chair-seat`, `chair-back`, 4 legs), facing the character | effect: at the end the hips are 5-25 cm above the seat top and over it · contact: at the end both soles are on the floor · effect: at the end the body faces the chair's front within 30 degrees · negative: no joint, hand or sole point deeper than 2 cm into the chair · negative: QA reports no collision with the chair |
| S10 | 바닥에 있는 상자를 두 손으로 들어서 탁자 위에 올려놔 | `box` on the floor, `table` (`table-top`, 4 legs) behind it | contact: both palms within 5 cm of the box when it first moves · negative: the box does not move before both hands are on it · contact: both palms within 6 cm on 80% of the frames it moves · effect: the box ends resting on the table top · negative: the box never more than 1 cm into the table · negative: the box never more than 1 cm into the floor |

A negative assertion holds when the bad thing did not happen, so a take that does nothing passes it; read negatives next to the effects. An effect never passes on a take where nothing moved.

### Running it

Start one Studio with the agent sidecar (as above), then run any set of scenarios in parallel. Each scenario gets its own headless Chrome on CDP port `--cdp + i` with a fresh profile, opens its fixture, selects the model and effort in the Agent pane, sends the request and waits for the turn:

```sh
node test/qa-agent-bench-motion-browser.mjs --scenarios S6,S7,S8,S9,S10 \
  --model cliproxy/claude-opus-5-5 --effort high \
  --url http://127.0.0.1:5180/app/ --cdp 9395 \
  --out /tmp/cozyclay-agent-bench-motion --label baseline
```

`--headed` shows the windows, `--keep` leaves them open afterwards, `--timeout-min N` sets the per-turn deadline (default 60; the harness then presses Stop). The run writes `<out>/<label>.json` (rows of other models and scenarios are kept) and, per scenario, `<out>/<label>/<id>-<model-slug>/` with `doc.json` (the document after the turn), `final.png` and `row.json`. The agent session is read from `~/.config/cozyclay/agent-sessions/<sessionId>.jsonl` (`COZYCLAY_AGENT_SESSIONS` overrides).

| Field | Definition |
| --- | --- |
| `assertions` | `[{ id, kind, text, pass, value, frame, note? }]` in the table's order |
| `passed`, `total`, `passRate` | Assertions that hold, of all of them |
| `byKind` | `{ cause, contact, effect, negative: [passed, total] }` |
| `qa` | `{ ok, total }` of the installed take compiled again (the goals included) |
| `goals` | Names of the goals the agent wrote in the installed spec |
| `compiles` | `motion.compile` actions, plus each `motion.compile` a `script` call names |
| `toolCalls`, `byTool`, `errors` | Tool calls of the session, per tool, and the failed ones |
| `setChanged` | Set pieces the agent moved, resized, reparented or removed |
| `turnMs`, `timedOut`, `wallMs` | The turn's time, whether the deadline stopped it, and the whole row's time |
| `reason`, `error` | Why nothing was measured (no installed take; the spec no longer compiles) or what failed in the harness |
| `reply` | The agent's last text |

`node --test test/bus/verify-bench-motion.mjs` checks the measurement: the fixtures match the builder, real compiles of the seat skill score as they should on S9, and synthetic tracks for S6-S10 pass when cause, contact and effect come in order and fail when the effect comes first.
