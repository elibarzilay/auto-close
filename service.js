const DEFAULT_WAIT = "10s";
const DEFAULT_SITES = [{
  url: "https://{*.|}zoom.us/",
  title: "Launch Meeting * Zoom",
  contents: "{Your meeting has been launched|click Launch Meeting below}",
  wait: "30s",
}];

let sites = [];
chrome.storage.sync.get("sites", ({ sites: s }) => {
  if (Array.isArray(s) && s.length > 0) return sites = s;
  chrome.storage.sync.set({ sites: DEFAULT_SITES });
  sites = DEFAULT_SITES;
});
chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "sync") return;
  const newValue = changes.sites?.newValue;
  if (!(Array.isArray(newValue) && newValue.length > 0)) return;
  sites = changes.sites?.newValue;
});

const globModes = {
  pathStart: { pfx: "^",   sfx: "",    flags: "s",  dStar: true,  spaces: false},
  textAll:   { pfx: "^",   sfx: "$",   flags: "si", dStar: false, spaces: true },
  textHas:   { pfx: "\\b", sfx: "\\b", flags: "si", dStar: false, spaces: true },
};
const glob = (pat, mode) => {
  const m = globModes[mode];
  if (!m) throw Error(`unknown glob mode: ${mode}`);
  const { pfx, sfx, flags, dStar, spaces } = m;
  let brace = 0;
  return new RegExp(
    pfx
    + pat.replace(/\\[*{|}]?|\*+| +|[.?+^$\[\](){|}]/g, m =>
      dStar && m === "*"   ? "[^/]*"
      : m[0] === "*"       ? ".*"
      : m === "\\"         ? "\\\\"
      : m[0] === "\\"      ? m
      : m[0] === " "       ? (spaces ? "\\s+" : m)
      : brace && m === "|" ? m
      :          m === "{" ? (brace++, "(?:")
      : brace && m === "}" ? (brace--, ")")
      : "\\"+m)
    + ")".repeat(brace)
    + sfx,
    flags);
};

const compileSites = sites => {
  if (compileSites.lastSites !== sites) {
    compileSites.compiled = sites.map(site => ({
      url:      !site.url ? undefined : glob(site.url, "pathStart"),
      title:    !site.title ? undefined : glob(site.title, "textAll"),
      contents: !site.contents ? undefined : glob(site.contents, "textHas"),
      wait:     site.wait,
    }));
    compileSites.lastSites = sites;
  }
  return compileSites.compiled;
};

const contentHas = async (tab, rx) => (await chrome.scripting.executeScript({
  target: { tabId: tab.id },
  func: (rx, fs) => (new RegExp(rx, fs)).test(document.body.innerText),
  args: [rx.source, rx.flags],
}))?.[0]?.result;

const shouldClose = async tab => {
  for (const site of compileSites(sites))
    if (   (!site.url      || site.url.test(tab.url))
        && (!site.title    || site.title.test(tab.title))
        && (!site.contents || await contentHas(tab, site.contents)))
      return site;
};

const closingTabIds = new Set();
const startClosing = (tab, wait) => {
  closingTabIds.add(tab.id);
  console.log(`${wait} countdown to closing "${tab.title}" (${tab.url})...`);
};
const actualClose = tab => {
  if (!closingTabIds.has(tab.id)) return;
  closingTabIds.delete(tab.id);
  chrome.tabs.remove(tab.id)
    .then(_ => console.log(`Closed "${tab.title}".`, tab))
    .catch(_ => console.log(`Couldn't "${tab.title}", probably closed manually.`, tab));
};
const cancelClose = tab => {
  if (!closingTabIds.has(tab.id)) return;
  closingTabIds.delete(tab.id);
  console.log(`Canceled closing "${tab.title}".`, tab);
};

const closeTab = (tab, wait) => {
  startClosing(tab, wait);
  chrome.scripting.executeScript({ target: { tabId: tab.id },
                                   func: kiiillMeee, args: [wait] });
  const [time, unit] = wait.toLowerCase().match(/^ *(\d+) *(m?s)?/).slice(1);
  const ms = +time * (unit === "s" ? 1000 : 1);
  setTimeout(() => actualClose(tab), ms + 500);
};

chrome.runtime.onMessage.addListener((msg, { tab }, send) =>
    msg === "settings" ? chrome.runtime.openOptionsPage()
  : msg === "defaults" ? send(DEFAULT_SITES)
  : msg === "kill.me." ? actualClose(tab)
  : msg === "no.kill." ? cancelClose(tab)
  : undefined);

const kiiillMeee = wait => {
  const div = (style, ...children) => {
    const d = document.createElement("div");
    Object.assign(d.style, style);
    children.forEach(c =>
      typeof c === "string" ? d.innerHTML += c : d.append(c));
    return d;
  };
  const barStyle = {
    position: "absolute", left: 0, top: 0, height: "2.5em", width: "100%",
  };
  let top, settings, progress;
  document.body.parentElement.append(
    top = div({
      position: "fixed", left: 0, top: 0, width: "100%", height: "100%",
      zIndex: 9999, backgroundColor: "#8888",
      backdropFilter: "grayscale(1) blur(3px)",
      color: "#fe4", fontSize: "24px", fontWeight: "bolder", textAlign: "center",
    }, div({ ...barStyle, backgroundColor: "#422", }),
       settings = div({
         position: "fixed", right: 0, top: 0, cursor: "pointer",
         backgroundColor: "#8888", color: "#fe4", borderRadius: "3px",
         margin: "6px 12px", padding: "6px 12px", opacity: 0.75,
         fontSize: "24px", fontWeight: "bolder",
       }, "Auto Close Settings"),
       progress = div({ ...barStyle,
         backgroundColor: "#000c", transition: `width ${wait} linear`,
       }),
       div({ ...barStyle,
         width: "100%", height: "2em", paddingTop: "1ex", cursor: "pointer",
       }, "🙅 Closing")));
  setTimeout(() => progress.style.width = "0%", 100);
  progress.addEventListener("transitionend", () =>
    chrome.runtime.sendMessage("kill.me."));
  const stopClosing = () => {
    chrome.runtime.sendMessage("no.kill.");
    top.remove();
    document.body.parentElement.append(settings);
    settings.style.zIndex = 999999;
  };
  top.addEventListener("click", stopClosing);
  settings.addEventListener("click", () => chrome.runtime.sendMessage("settings"));
  settings.addEventListener("mouseenter", () => settings.style.opacity = 1);
  settings.addEventListener("mouseleave", () => settings.style.opacity = 0.75);
  window.addEventListener("keydown", ({ key }) => key === "Escape" && stopClosing());
};

chrome.tabs.onUpdated.addListener(async (_, change, tab) => {
  if (change?.status !== "complete") return;
  const site = await shouldClose(tab);
  if (!site) return;
  closeTab(tab, site.wait || DEFAULT_WAIT);
});
