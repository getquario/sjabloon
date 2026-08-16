import {
	isDiagnostic,
	template,
	text,
	type SjabloonBlock,
	type SjabloonDiagnostic,
	type SjabloonErrorCode,
	type Token,
} from '../lib/index.js';
import { template as htmlTemplate } from '../lib/html.js';
import { template as textTemplate } from '../lib/text.js';

const render = template('{{ user.name }}');
const tokens: Token[] = render({ user: { name: 'Robin' } });
const joined: string = text(tokens);
const names: string[] = render.names;
const functions: string[] = render.functions;

const markup: string = htmlTemplate('{{ x }}')({ x: 1 });
const bare: string = textTemplate('{{ x }}')({ x: 1 });
const anchored: Token[] = render({}, { root: { user: { name: 'R' } }, item: {} });

// @ts-expect-error the root entry renders tokens, not a string
const wrongRoot: string = template('{{ x }}')({});

// @ts-expect-error the html entry renders a string, not tokens
const wrongHtml: Token[] = htmlTemplate('{{ x }}')({});

// One shared union across every entry, including the new raw-tag code.
const codes: SjabloonErrorCode[] = ['SJABLOON_RAW_TAG', 'SJABLOON_TOO_DEEP'];

try {
	render();
} catch (error: unknown) {
	if (isDiagnostic(error)) {
		const diagnostic: SjabloonDiagnostic = error;
		const code: SjabloonErrorCode = diagnostic.code;
		const start: number = diagnostic.start;
		const end: number = diagnostic.end;
		const blocks: readonly SjabloonBlock[] = diagnostic.blocks;
		const type: 'if' | 'each' | undefined = blocks[0]?.type;
		void [code, start, end, type];

		// @ts-expect-error diagnostic positions are readonly
		diagnostic.start = 1;

		// @ts-expect-error diagnostic block context is readonly
		blocks.push({ type: 'if', start: 0, end: 1 });
	}
}

void [joined, names, functions, markup, bare, anchored, wrongRoot, wrongHtml, codes];
