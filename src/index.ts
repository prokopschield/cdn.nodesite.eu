import { getConfig } from 'doge-config';
import { contentType, extension } from 'mime-types';
import { NodeSiteRequest } from 'nodesite.eu';
import { listen } from 'nodesite.eu-local';
import nsblob from 'nsblob';
import { cacheFn, sanitizeHeaders } from 'ps-std';

export const config = getConfig('cdn.nodesite.eu', {
	name: 'cdn',
});

if (!config.str.name.includes('.nodesite.eu')) {
	config.str.name += '.nodesite.eu';
}

export const { create } = listen({
	interface: 'http',
	name: config.str.name,
	port: 20123,
});

export const regex_hash = /[0-9a-f]{64}/gi;
export const regex_ext = /\.[a-z0-9]+/g;

export function reduce(
	...args: Array<string[] | string | null | undefined>
): string | false {
	for (let arg = args.shift(); arg || args.length; arg = args.shift()) {
		if (arg) {
			if (arg instanceof Array) {
				args.unshift(...arg);
			} else if (typeof arg === 'string') {
				return arg;
			}
		}
	}
	return false;
}

export const urls = new Map<string, string>();

export function registerResource(uri: string, hash: string) {
	const url = new URL(uri, 'http://localhost');
	if (!urls.has(url.pathname)) {
		urls.set(url.pathname, hash);
	}
}

export const getRegisteredResource = cacheFn((uri: string) => {
	const url = new URL(uri, 'http://localhost');
	if (url.pathname === '/') {
		// TODO add index page here
	}
	return urls.get(url.pathname);
});

export async function putRequestHandler(req: NodeSiteRequest) {
	const headers = sanitizeHeaders(req.head);
	const content_type = headers['Content-Type'];
	const hash = await nsblob.store(req.body);
	registerResource(req.uri, hash);
	return {
		head: {
			'Content-Type': 'application/json',
			'Access-Control-Allow-Origin': '*',
			'Access-Control-Allow-Methods': 'PUT',
			'Access-Control-Allow-Headers': '*',
		},
		body: JSON.stringify({
			hash,
			url: `https://${config.str.name}/${hash}.${extension(
				content_type || 'application/octet-stream'
			)}`,
		}),
	};
}

export function parseContentRange(
	range_header: string,
	content_length: number
): [number, number][] | void {
	const ranges = String(range_header).match(/(\d*\-\d*)/g);

	if (ranges) {
		return [...ranges].map((range) => {
			return parseContentRangePair(range, content_length);
		});
	}
}

export function parseContentRangePair(
	range_str: string,
	content_length: number
): [number, number] {
	const [lesser, greater] = range_str.split('-').map(Number);

	if (lesser && greater) {
		return [Number(lesser), Number(greater)];
	} else if (lesser) {
		return [Number(lesser), content_length - 1];
	} else if (greater) {
		return [content_length - Number(greater) - 1, content_length - 1];
	} else {
		return [0, content_length - 1];
	}
}

create('/', async (req: NodeSiteRequest) => {
	if (req.body && req.body.length) {
		return putRequestHandler(req);
	} else {
		const ar_hash = req.uri.match(regex_hash);
		const ar_ext = req.uri.match(regex_ext);

		const hash = reduce(ar_hash, getRegisteredResource(req.uri));
		const ext = reduce(ar_ext) || '.html';
		const content_type = contentType(ext) || 'text/plain';

		if (hash) {
			const data = await nsblob.fetch(hash);

			if (req.method === 'GET') {
				const ranges = parseContentRange(
					String(req['head']['range']),
					data.length
				);

				if (ranges) {
					const [range] = ranges;
					const [start, end] = range;

					const slice = data.subarray(start, end + 1);

					return {
						statusCode: 206,
						head: {
							'Accept-Ranges': 'bytes',
							'Content-Type': content_type,
							'Content-Length': data.length,
							'Content-Range': `bytes ${start}-${end}/${data.length}`,
							'Access-Control-Allow-Origin': '*',
							'Access-Control-Allow-Methods': 'GET, PUT',
							'Access-Control-Allow-Headers': '*',
						},
						body: slice,
					};
				}

				return {
					head: {
						'Accept-Ranges': 'bytes',
						'Content-Type': content_type,
						'Content-Length': data.length,
						'Access-Control-Allow-Origin': '*',
						'Access-Control-Allow-Methods': 'GET, PUT',
						'Access-Control-Allow-Headers': '*',
					},
					body: data,
				};
			} else {
				return {
					'Accept-Ranges': 'bytes',
					'Content-Type': contentType(ext) || 'text/plain',
					'Content-Length': data.length,
					'Access-Control-Allow-Origin': '*',
					'Access-Control-Allow-Methods': 'GET, PUT',
					'Access-Control-Allow-Headers': '*',
				};
			}
		} else {
			return {
				statusCode: 404,
				head: {
					'Content-Type': 'application/json',
					'Access-Control-Allow-Origin': '*',
					'Access-Control-Allow-Methods': 'GET, PUT',
					'Access-Control-Allow-Headers': '*',
				},
				body: JSON.stringify({
					error: 404,
					url: req.uri,
				}),
			};
		}
	}
});

create('/put', putRequestHandler);
