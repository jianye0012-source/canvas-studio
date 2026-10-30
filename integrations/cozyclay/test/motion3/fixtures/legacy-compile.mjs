// The motion compiler as it ran before lane S1 (arms kept out of the body's fitted skin): fix.self off,
// and QA without the skin's BODY check (limit 1 m). Suites that pin earlier lanes' takes, hashes and QA
// counts compile through this; verify-motion3-self covers the default.
import { compileSpec as compile } from "../../../src/motion3/pipeline.js";

export const legacySpec = spec => ({ ...spec, fix: spec.fix === false ? false : { ...(spec.fix ?? {}), self: false },
	checks: { ...(spec.checks ?? {}), limits: { ...(spec.checks?.limits ?? {}), skin: 1 } } });

export const compileSpec = (spec, ctx, opts) => compile(legacySpec(spec), ctx, opts);
