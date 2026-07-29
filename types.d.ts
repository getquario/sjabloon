import type { XprsnErrorCode } from 'xprsn';

export type SjabloonErrorCode =
    | XprsnErrorCode
    | 'SJABLOON_EACH_SYNTAX'
    | 'SJABLOON_BLOCKED_BINDING'
    | 'SJABLOON_UNEXPECTED_TAG'
    | 'SJABLOON_UNKNOWN_BLOCK'
    | 'SJABLOON_UNCLOSED_BLOCK'
    | 'SJABLOON_TOO_DEEP'
    | 'SJABLOON_RAW_TAG';

export interface SjabloonBlock {
    readonly type: 'if' | 'each';
    readonly start: number;
    readonly end: number;
}

export interface SjabloonDiagnostic extends Error {
    readonly code: SjabloonErrorCode;
    readonly start: number;
    readonly end: number;
    readonly blocks: readonly SjabloonBlock[];
}

export type SjabloonValues = Record<string, any>;
export type SjabloonFunctions = Record<string, Function>;

/**
 * Per-render override of the scope anchors, for embedders with their own scope
 * model.
 *
 * Two anchors are always in scope: `$` is the root values, and `@` is the
 * current `#each` item (the root outside any loop). They let a nested loop
 * reach the root (`$.company`) or the current item (`@.total`) explicitly,
 * past any shadowing. Neither counts as a `name`.
 *
 * Passing this object as the renderer's second argument makes `$` become
 * `root` and `@` become `item` (two distinct objects). Omit `item` to leave
 * `@` unbound, so reading `@.x` throws through xprsn's guard — a group-header
 * band that has no current row wants exactly that.
 */
export interface SjabloonScope {
    root?: any;
    item?: any;
}

/**
 * A compiled template: render it many times.
 *
 * `names` are the variables the template reads from your values, deduplicated;
 * loop variables the template introduces are not included. `functions` are the
 * registry functions the template calls, deduplicated.
 */
export interface SjabloonRenderer<T> {
    (values?: SjabloonValues, scope?: SjabloonScope): T;
    names: string[];
    functions: string[];
}

/** One static text run of the template, verbatim. */
export interface LiteralToken {
    literal: string;
}

/** One `{{ }}` interpolation, pre-stringify. Nullish values are preserved. */
export interface ValueToken {
    value: unknown;
}

/**
 * A render's output in the token edition, in render order: loop bodies append
 * once per iteration, untaken branches append nothing, and block expressions
 * (`#if` conditions, `#each` collections) never appear.
 */
export type Token = LiteralToken | ValueToken;

/**
 * Check whether an error was produced or translated by sjabloon. Every entry
 * shares one core, so a diagnostic thrown through any of them authenticates
 * through all of them.
 */
export function isDiagnostic(error: unknown): error is SjabloonDiagnostic;
