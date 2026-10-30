import { spawn } from "node:child_process";

const IS_WINDOWS = process.platform === "win32";

export function spawnOwned(command, args = [], options = {}) {
	return spawn(command, args, {
		stdio: "inherit",
		...options,
		detached: !IS_WINDOWS,
	});
}

export function waitForExit(child) {
	if (child.exitCode !== null || child.signalCode !== null) {
		return Promise.resolve({ code: child.exitCode, signal: child.signalCode });
	}
	return new Promise((resolve) => {
		const finish = (result) => {
			child.off("exit", onExit);
			child.off("error", onError);
			resolve(result);
		};
		const onExit = (code, signal) => finish({ code, signal });
		const onError = () => finish({ code: 1, signal: null });
		child.once("exit", onExit);
		child.once("error", onError);
	});
}

function signalOwned(child, signal) {
	if (!child || child.exitCode !== null || child.signalCode !== null) return;
	try {
		if (IS_WINDOWS) child.kill(signal);
		else process.kill(-child.pid, signal);
	} catch (error) {
		if (error?.code === "ESRCH") return;
		if (!IS_WINDOWS && error?.code === "EPERM") {
			try {
				child.kill(signal);
				return;
			} catch (fallbackError) {
				if (fallbackError?.code === "ESRCH") return;
				throw fallbackError;
			}
		}
		throw error;
	}
}

export async function terminateOwned(child, graceMs = 1500) {
	if (!child || child.exitCode !== null || child.signalCode !== null) return;
	const exited = waitForExit(child);
	signalOwned(child, "SIGTERM");
	const graceful = await Promise.race([
		exited.then(() => true),
		new Promise((resolve) => setTimeout(() => resolve(false), graceMs)),
	]);
	if (!graceful) {
		signalOwned(child, "SIGKILL");
		await exited;
	}
}

export function installSignalCleanup(getChildren, cleanup) {
	let stopping = false;
	const handlers = new Map();
	for (const signal of ["SIGINT", "SIGTERM"]) {
		const handler = async () => {
			if (stopping) return;
			stopping = true;
			await Promise.allSettled(getChildren().map((child) => terminateOwned(child)));
			await cleanup?.();
			process.exitCode = signal === "SIGINT" ? 130 : 143;
		};
		handlers.set(signal, handler);
		process.on(signal, handler);
	}
	return () => {
		for (const [signal, handler] of handlers) process.off(signal, handler);
	};
}
