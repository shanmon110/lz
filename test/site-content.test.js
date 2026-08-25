const { test } = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { existsSync, readFileSync } = require("node:fs");
const { join, resolve } = require("node:path");

const repositoryRoot = resolve(__dirname, "..");

function sourceFile(relativePath) {
  let source;
  try {
    source = readFileSync(join(repositoryRoot, relativePath), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      assert.fail(`required page source exists: ${relativePath}`);
    }
    throw error;
  }
  return source;
}

function frontMatter(relativePath) {
  const source = sourceFile(relativePath);
  const match = /^---\r?\n([\s\S]*?)\r?\n---(?:\r?\n|$)/.exec(source);
  assert.ok(match, `${relativePath} has opening and closing YAML front matter delimiters`);

  let output;
  try {
    output = execFileSync("ruby", ["-ryaml", "-rjson", "-e", `
      data = YAML.safe_load(STDIN.read, aliases: false)
      abort "front matter must be a mapping" unless data.is_a?(Hash)
      puts JSON.generate(data)
    `], {
      input: match[1],
      encoding: "utf8",
      stdio: ["pipe", "pipe", "pipe"]
    });
  } catch (error) {
    const detail = String(error.stderr || error.message).trim();
    assert.fail(`${relativePath} has valid YAML front matter: ${detail}`);
  }

  try {
    return JSON.parse(output);
  } catch (error) {
    assert.fail(`${relativePath} YAML front matter parser returned JSON: ${error.message}`);
  }
}

function sourceBody(relativePath) {
  const source = sourceFile(relativePath);
  const match = /^---\r?\n[\s\S]*?\r?\n---(?:\r?\n|$)/.exec(source);
  assert.ok(match, `${relativePath} has opening and closing YAML front matter delimiters`);
  frontMatter(relativePath);
  return source.slice(match[0].length);
}

function rendered(relativePath) {
  return execFileSync("pandoc", ["--from", "gfm", "--to", "html"], {
    input: sourceBody(relativePath),
    encoding: "utf8"
  });
}

test("keeps the six navigation destinations and service redirects in valid front matter", () => {
  const canonicalPermalinks = [
    ["_pages/about.md", "/"],
    ["_pages/publications.md", "/publications/"],
    ["_pages/tutorials.md", "/tutorials/"],
    ["_pages/talks.html", "/talks/"],
    ["_pages/academic-service.md", "/academic-service/"],
    ["_pages/teaching.html", "/teaching/"]
  ];

  for (const [relativePath, expectedPermalink] of canonicalPermalinks) {
    assert.equal(frontMatter(relativePath).permalink, expectedPermalink, `${relativePath} uses its canonical permalink`);
  }

  assert.deepEqual(frontMatter("_pages/academic-service.md").redirect_from, [
    "/markdown/",
    "/md/",
    "/markdown.html"
  ]);
  assert.equal(existsSync(join(repositoryRoot, "_pages/markdown.md")), false, "legacy markdown page source is removed");
});

function navigationEntries() {
  const output = execFileSync("ruby", ["-ryaml", "-rjson", "-e", `
    data = YAML.load_file(ARGV.fetch(0))
    puts JSON.generate(data.fetch("main").map { |entry| entry.slice("title", "url") })
  `, join(repositoryRoot, "_data/navigation.yml")], {
    encoding: "utf8"
  });
  return JSON.parse(output);
}

test("publishes the approved navigation and separated academic content", () => {
  const navigation = navigationEntries();
  assert.deepEqual(navigation, [
    { title: "Home", url: "/" },
    { title: "Publications", url: "/publications/" },
    { title: "Tutorials", url: "/tutorials/" },
    { title: "Talks", url: "/talks/" },
    { title: "Academic Service", url: "/academic-service/" },
    { title: "Teaching", url: "/teaching/" }
  ]);
  assert.doesNotMatch(JSON.stringify(navigation), /CV|Services/);

  const indexHtml = rendered("_pages/about.md");
  const tutorialsHtml = rendered("_pages/tutorials.md");
  const talksHtml = rendered("_pages/talks.html");
  const serviceHtml = rendered("_pages/academic-service.md");
  const teachingHtml = rendered("_pages/teaching.html");

  assert.doesNotMatch(indexHtml, />CV</);
  assert.match(tutorialsHtml, /interspeech2026\.org\/en-AU\/pages\/programme\/tutorials/);
  assert.match(tutorialsHtml, /2026\.ieeeicme\.org\/tutorials/);
  assert.doesNotMatch(tutorialsHtml, /mmasia2026/);
  assert.match(serviceHtml, /mmasia2026\.org\/calls\/special-session-trustworthy-speech-audio-ai/);
  assert.match(serviceHtml, /Trustworthy Speech and Audio AI: From Content Authenticity to Accountable Systems/);
  assert.match(serviceHtml, /Special Session Co-Organizer/);
  assert.match(serviceHtml, /ACM Multimedia Asia 2026 \(MMAsia 2026\)/);
  assert.match(serviceHtml, /Hanoi, Vietnam/);
  assert.match(serviceHtml, /December 15–18, 2026/);
  assert.doesNotMatch(serviceHtml, /Speech Large Language Models: Architectures/);
  assert.match(talksHtml, /bilibili\.com\/video\/BV17T42127Wd/);
  assert.match(teachingHtml, /Speech Processing and Recognition/);
});

test("keeps the homepage concise while routing readers to dedicated pages", () => {
  const indexHtml = rendered("_pages/about.md");

  assert.match(indexHtml, /Postdoctoral Fellow at <strong>The University of Hong Kong \(HKU\)<\/strong>/);
  assert.match(indexHtml, /mmasia2026\.org\/calls\/special-session-trustworthy-speech-audio-ai/);
  assert.match(indexHtml, /interspeech2026\.org\/en-AU\/pages\/programme\/tutorials/);
  assert.match(indexHtml, /2026\.ieeeicme\.org\/tutorials/);
  assert.match(indexHtml, /Presented the <a href="https:\/\/2026\.ieeeicme\.org\/tutorials\/#1766933845252-bb9d3b7e-7e8e">Speech Large Language Models: Architectures, Efficient Adaptation, and Applications<\/a> tutorial/);
  assert.doesNotMatch(indexHtml, /Presenting the <a href="https:\/\/2026\.ieeeicme\.org\/tutorials\/#1766933845252-bb9d3b7e-7e8e">/);
  assert.match(indexHtml, /<a href="https:\/\/mp\.weixin\.qq\.com\/s\/HgcGxSYnunYZaDQIU7Tjuw"><strong>Outstanding Scientific and Technological Achievement Award<\/strong><\/a>/);

  for (const destination of [
    "/publications/",
    "/tutorials/",
    "/talks/",
    "/academic-service/",
    "/teaching/"
  ]) {
    assert.match(indexHtml, new RegExp(`href="${destination}"`));
  }

  assert.match(indexHtml, /Nov\. 2025–Present/);
  assert.match(indexHtml, /Feb\. 2025–Oct\. 2025/);
  assert.match(indexHtml, /Mar\. 2024–Nov\. 2024/);
  assert.doesNotMatch(indexHtml, /JCR|impact factor|NEEDS VERIFICATION/i);
});

test("publishes all eight CV talks in reverse chronological order with only supplied links", () => {
  const talksHtml = rendered("_pages/talks.html");
  const orderedTitles = [
    "Disentangling Speaker and Content in Pre-trained Speech Models with Latent Diffusion for Robust Speaker Verification",
    "Spectral-Aware Low-Rank Adaptation for Speaker Verification",
    "Parameter-efficient Fine-tuning of Speaker-Aware Dynamic Prompts for Speaker Verification",
    "Dual Parameter-Efficient Fine-Tuning for Speaker Representation via Speaker Prompt Tuning and Adapters",
    "Maximal Speaker Separability via Robust Speaker Representation Learning",
    "Discriminative Speaker Representation via Contrastive Learning with Class-Aware Attention in Angular Space",
    "Speaker Verification: Pre-trained Model, Attention Augmented, and Contrastive Learning",
    "Chinese-Uyghur Medical Domain Neural Machine Translation: Towards Knowledge-driven"
  ];
  let previousIndex = -1;

  for (const title of orderedTitles) {
    const titleIndex = talksHtml.indexOf(title);
    assert.ok(titleIndex > previousIndex, `${title} appears in reverse chronological order`);
    previousIndex = titleIndex;
  }

  assert.equal((talksHtml.match(/<li>/g) || []).length, 8);
  assert.match(talksHtml, /https:\/\/mp\.weixin\.qq\.com\/s\/HpGImdW7ObP8Io49GDwZ5g/);
  assert.match(talksHtml, /https:\/\/connectpolyu-my\.sharepoint\.com\/:v:\/g\/personal\/21118664r_connect_polyu_hk\/EYFhJ06ZZrdKvxtFH4HXS60BNHYyAdr8NxdkKVe5tQLsUQ\?e=0mzAD2/);
  assert.match(talksHtml, /https:\/\/mp\.weixin\.qq\.com\/s\/1rumaLXfNoLEVM9HZNT3Eg/);
  assert.match(talksHtml, /https:\/\/www\.bilibili\.com\/video\/BV17T42127Wd\?t=47\.1/);
  assert.match(talksHtml, /https:\/\/www\.bilibili\.com\/video\/BV1y8411S7Qg\/\?spm_id_from=333\.999\.0\.0&amp;vd_source=72429a47df312126433e0bb950f77049&amp;t=0\.9/);
  assert.match(talksHtml, /https:\/\/www\.bilibili\.com\/video\/BV18S4y1p7xY\/\?p=8&amp;vd_source=72429a47df312126433e0bb950f77049&amp;t=0\.9/);
  assert.match(talksHtml, /https:\/\/www\.bilibili\.com\/video\/BV1PD4y197ma\/\?p=6/);
  assert.doesNotMatch(talksHtml, /<a[^>]*>Maximal Speaker Separability via Robust Speaker Representation Learning<\/a>/);
  assert.doesNotMatch(talksHtml, /<a[^>]*><cite>Maximal Speaker Separability via Robust Speaker Representation Learning<\/cite><\/a>/);
  assert.doesNotMatch(talksHtml, /site\.talks|archive-single-talk/);
});

test("publishes exactly the four CV teaching courses and their responsibilities", () => {
  const teachingHtml = rendered("_pages/teaching.html");

  assert.equal((teachingHtml.match(/<li>/g) || []).length, 4);
  assert.match(teachingHtml, /Speech Processing and Recognition/);
  assert.match(teachingHtml, /Deep Learning and Deep Neural Networks/);
  assert.match(teachingHtml, /Multimodal Human-Computer Interaction Technologies/);
  assert.match(teachingHtml, /Foundations of Data Science/);
  assert.match(teachingHtml, /Supervised laboratory sessions/);
  assert.match(teachingHtml, /developed lab exercises/);
  assert.match(teachingHtml, /guided student projects/);
  assert.match(teachingHtml, /course administration/);
  assert.doesNotMatch(teachingHtml, /site\.teaching|archive-single/);
});

test("reconciles the latest publications without inventing unverified links", () => {
  const publicationsHtml = rendered("_pages/publications.md");

  assert.match(publicationsHtml, /Junjiang Yuan, <strong>Zhe Li<\/strong>, and Tingbin Zhang/);
  assert.match(publicationsHtml, /Towards robust remote sensing visual question answering with spectral expert adaptation and group-relative optimization/);
  assert.match(publicationsHtml, /https:\/\/doi\.org\/10\.1016\/j\.neunet\.2026\.109308/);
  assert.match(publicationsHtml, /Yaxuan Qiu, <strong>Zhe Li<\/strong>, Mieradilijiang Maimaiti, Zunwang Ke, and Wushour Silamu/);
  assert.doesNotMatch(publicationsHtml, /Zunwang Ke, Yanbing Li, and Wushour Silamu/);
  assert.match(publicationsHtml, /Towards a unified view of parameter-efficient speech pretrained models for speaker verification/);
  assert.match(publicationsHtml, /https:\/\/doi\.org\/10\.1109\/TASLPRO\.2026\.3682068/);
  assert.doesNotMatch(publicationsHtml, /<a[^>]*>Mixture of spectral experts for audio deepfake detection<\/a>/i);
  assert.doesNotMatch(publicationsHtml, /<a[^>]*>Domain-adaptive dual-gating mixture of experts for generalizable speech deepfake detection<\/a>/i);
  assert.doesNotMatch(publicationsHtml, /<a[^>]*>Beyond residual connections: Manifold-constrained hyper-connections for robust speaker representation learning<\/a>/i);
  assert.doesNotMatch(publicationsHtml, /<a[^>]*>STEP: Semantic-guided two-stage framework with skeleton-conditioned prompting for skeleton-based action recognition<\/a>/i);
  assert.doesNotMatch(publicationsHtml, /JCR|impact factor|NEEDS VERIFICATION/i);
});
