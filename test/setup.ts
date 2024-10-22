import fetch, {Headers, Request, Response} from 'node-fetch'
import {TextDecoder, TextEncoder} from 'util'

// @ts-expect-error interface missmatch
globalThis.fetch = fetch
// @ts-expect-error interface missmatch
globalThis.Headers = Headers
// @ts-expect-error interface missmatch
globalThis.Request = Request
// @ts-expect-error interface missmatch
globalThis.Response = Response
// @ts-expect-error interface missmatch
globalThis.TextDecoder = TextDecoder
globalThis.TextEncoder = TextEncoder
