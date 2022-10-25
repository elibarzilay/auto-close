const FIELDS = [
  { name: "url",
    desc: "URL prefix, can use '*', '**', or '{x|y|...}'" },
  { name: "title",
    desc: "Tab title, use '*' at the beginning/end for partial matching" },
  { name: "contents",
    desc: "Page contents to look for (word-matches, can use '*')" },
  { name: "wait",
    desc: "delay (s/ms)",
    validate: w => w.trim().toLowerCase().replace(
      /^(\d+)? *(m?s)?.*/, (_, n, u) =>
      n || u ? (n || 1) + (u || "s") : "") },
];

const t = document.querySelector("#sites > table");
const tH = t.querySelector("thead");
const tB = t.querySelector("tbody");

const isPlainObject = x => {
  if (typeof x !== "object" || x === null) return false;
  const prototype = Object.getPrototypeOf(x);
  return prototype === Object.prototype || prototype === null;
};

const mk = (tag, ...elts) => {
  const attrs = elts.length && isPlainObject(elts[0]) && elts.shift();
  const elt = document.createElement(tag);
  if (attrs) Object.assign(elt, attrs);
  const loop = e => e && (
    e instanceof Node ? elt.appendChild(e)
    : Array.isArray(e) ? e.forEach(loop)
    : typeof e !== "string" && e?.[Symbol.iterator] ? loop(Array.from(e))
    : loop(document.createTextNode(e))
  );
  elts.forEach(loop);
  return elt;
};

tH.append(...FIELDS.map(f => mk("th", f.name)));

const inpChange = ({ target: inp }) => {
  const valid = FIELDS.find(f => f.name === inp.name).validate?.(inp.value);
  if (valid) inp.value = valid;
  const tr = inp.closest("tr");
  const vals = [...tr.querySelectorAll("input")].map(
    i => i.name === "wait" ? "" : i.value).join("");
  if (tr === tr.parentElement.lastChild) {
    if (vals !== "") tr.parentElement.append(mkRow(null));
    cellHandlers(tr.parentElement.lastChild);
  } else {
    if (vals === "") tr.remove();
  }
};

const mkCell = site => field =>
  mk("td", { className: field.name },
     mk("input", { type: "text", value: site?.[field.name] ?? "",
                   "name": field.name, placeholder: field.desc }));
const mkRow = site => mk("tr", FIELDS.map(mkCell(site)));
const cellHandlers = elt => elt.querySelectorAll("input").forEach(inp =>
  inp.addEventListener("change", inpChange));

const updateSites = sites => {
  if ("sites" in sites) sites = sites.sites;
  while (tB.lastChild) tB.removeChild(tB.lastChild);
  const inputs = [];
  tB.append(...sites.map(mkRow), mkRow(null));
  cellHandlers(tB);
};

const getSites = () =>
  [...tB.querySelectorAll("tr")].slice(0, -1).map(tr =>
    Object.fromEntries([...tr.querySelectorAll("input")].map(inp =>
      [inp.name, inp.value])));

const button = {
  Revert:   () => chrome.storage.sync.get("sites", updateSites),
  Defaults: () => chrome.runtime.sendMessage("defaults").then(updateSites),
  Apply:    () => chrome.storage.sync.set({sites: getSites()}),
};

document.querySelectorAll("button").forEach(b => {
  b.addEventListener("click", ({target}) => {
    target.classList.add("clicked");
    setTimeout(() => target.classList.remove("clicked"), 100);
    button[b.textContent]();
  });
});

button.Revert();
