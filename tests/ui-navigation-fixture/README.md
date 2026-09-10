# UI navigation fixture

Runs the actual built client bundle through a minimal DSH ModuleLoader adapter, with mock state, routines and workspace responses. No model calls or real user data.

```sh
UI_CLIENT_BUNDLE=/absolute/path/to/unpacked/package/lib/client.js node tests/ui-navigation-fixture/run.mjs
```

Open http://127.0.0.1:8796 in the agent browser. Check home, new-bot menu and chief chat use the same chief SVG (including legacy emoji without variation selector); click the two footer buttons at normal width and after “切换窄栏”; verify routines render in the main region and workspace has no default iframe. Expand the reference gallery to check all 18 approved avatar resources load. Finder reveal is mocked here; actual package lifecycle is separately checked by r3-accept.

Requires the existing /tmp/react-test-env dependency environment. Stop the fixture with Ctrl-C. Generated harness.page.js is ignored.

Scroll regression: chief chat loads 40 long messages. Verify the log has bounded clientHeight and scrollHeight > clientHeight, and the bottom gap (scrollHeight - clientHeight - scrollTop) is within 2px. Scroll to the top, submit a message with Enter, and verify SCROLL_REPLY_END is at the bottom after the history refresh. Grow the last message height to simulate delayed content layout and recheck the gap. This fixture uses no real model calls.
