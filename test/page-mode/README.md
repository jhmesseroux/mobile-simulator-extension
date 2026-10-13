# Page mode harness

`python3 test/page-mode/server.py`, then open in Chrome (reload the unpacked extension first):

| URL | Expect |
|---|---|
| http://localhost:8767/#mobile-sim | phone docked right, `data-mobile-sim="ready"`, probe inside shows ~390px, `mobileQuery: true`, iPhone UA, `maxTouchPoints: 5` |
| …/#mobile-sim=pixel-10-pro,landscape,full | Android UA, landscape, full window |
| …/deny.html#mobile-sim | loads thanks to the tab-scoped header rule (`ready`); turn page mode off → `not-allowed` |
| …/csp.html#mobile-sim | phone styled (constructable stylesheet) and the page loads |
| …/framebust.html#mobile-sim | the inner page escapes: page mode reports it / closes, nothing breaks |
| route links inside the phone | SPA navigation stays inside the phone; reload keeps the phone open |
| Esc / ✕ | phone closes, page margin restored, `data-mobile-sim="off"` |
| `postMessage({ __mobileSimPage: 'open', device: 'iphone-se' }, '*')` | opens without a hash |
