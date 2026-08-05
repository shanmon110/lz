# Task 4 report: fail-open public reverse proxy

## RED

- Added `test/public-handler.test.ts` before the handler implementation.
- Ran `npm test -- test/public-handler.test.ts`.
- The suite failed as expected because `../src/public-handler` did not exist.

## GREEN

- Added `handlePublicRequest(request, env, ctx, fetchOrigin = fetch)`.
- The handler starts the origin fetch before classifying or scheduling a D1 write.
- Eligible document visits are written once through `ctx.waitUntil`; assets schedule no write.
- D1 write failures are caught and operationally reported without visit data, while the original origin response is returned unchanged.
- The public body-forwarding test proves the handler neither consumes nor clones an inbound request body.
- `lizhe.link` and `www.lizhe.link` route to the public handler. All other hosts, including `logs.lizhe.link`, return 404 for later admin handling.

## Verification

```text
npm test -- test/public-handler.test.ts
# 4 passed

npm run check
# typecheck passed; 6 files and 37 tests passed
```

## Commit

`feat: add fail-open visitor logging proxy`

## Review notes / concerns

- The D1 success-path test uses the real test D1 database. Its only wrapper observes that the actual write begins after the injected origin fetch has started.
- The failure-path test uses the smallest rejecting D1 substitute needed to make the write fail; its assertions cover the returned origin response and captured `waitUntil` work, not the substitute itself.
- The visit schema requires `CF-Connecting-IP`; the successful proxy test supplies the normal Cloudflare ingress header. In production, that header is expected from Cloudflare's request path.
