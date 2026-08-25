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

function siteConfig() {
  const output = execFileSync("ruby", ["-ryaml", "-rjson", "-e", `
    data = YAML.safe_load(File.read(ARGV.fetch(0)), aliases: false)
    puts JSON.generate(data)
  `, join(repositoryRoot, "_config.yml")], {
    encoding: "utf8"
  });
  return JSON.parse(output);
}

test("serves core homepage assets from the custom domain", () => {
  const config = siteConfig();

  assert.equal(config.url, "https://lizhe.link");
  assert.equal(config.baseurl, "");
  assert.equal(config.repository, "shanmon110/lz");
  assert.equal(config.author.avatar, "lizhe.png");
  assert.equal(existsSync(join(repositoryRoot, "images", config.author.avatar)), true);

  const headTemplate = sourceFile("_includes/head.html");
  const scriptsTemplate = sourceFile("_includes/scripts.html");
  const authorTemplate = sourceFile("_includes/author-profile.html");

  assert.match(headTemplate, /href="{{ base_path }}\/assets\/css\/main\.css"/);
  assert.match(scriptsTemplate, /src="{{ base_path }}\/assets\/js\/main\.min\.js"/);
  assert.match(authorTemplate, /author\.avatar \| prepend: "\/images\/" \| prepend: base_path/);

  for (const template of [headTemplate, scriptsTemplate, authorTemplate]) {
    assert.doesNotMatch(template, /shanmon110\.github\.io|raw\.githubusercontent\.com/);
  }

  for (const assetPath of [
    "/assets/css/main.css",
    "/assets/js/main.min.js",
    `/images/${config.author.avatar}`
  ]) {
    assert.equal(new URL(assetPath, config.url).origin, "https://lizhe.link");
  }
});

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

test("keeps the homepage concise without a redundant dedicated-pages prompt", () => {
  const indexHtml = rendered("_pages/about.md");

  assert.match(indexHtml, /Zhe Li is a Postdoctoral Fellow at <a href="https:\/\/www\.hku\.hk\/">The University of Hong Kong<\/a>/);
  assert.match(indexHtml, /mmasia2026\.org\/calls\/special-session-trustworthy-speech-audio-ai/);
  assert.match(indexHtml, /interspeech2026\.org\/en-AU\/pages\/programme\/tutorials/);
  assert.match(indexHtml, /2026\.ieeeicme\.org\/tutorials/);
  assert.match(indexHtml, /Presented the <a href="https:\/\/2026\.ieeeicme\.org\/tutorials\/#1766933845252-bb9d3b7e-7e8e">Speech Large Language Models: Architectures, Efficient Adaptation, and Applications<\/a> tutorial/);
  assert.doesNotMatch(indexHtml, /Presenting the <a href="https:\/\/2026\.ieeeicme\.org\/tutorials\/#1766933845252-bb9d3b7e-7e8e">/);
  assert.match(indexHtml, /<a href="https:\/\/mp\.weixin\.qq\.com\/s\/HgcGxSYnunYZaDQIU7Tjuw"><strong>Outstanding Scientific and Technological Achievement Award<\/strong><\/a>/);
  assert.doesNotMatch(indexHtml, /See the dedicated pages for/);

  assert.match(indexHtml, /Nov\. 2025–Present/);
  assert.match(indexHtml, /Feb\. 2025–Oct\. 2025/);
  assert.match(indexHtml, /Mar\. 2024–Nov\. 2024/);
  assert.doesNotMatch(indexHtml, /JCR|impact factor|NEEDS VERIFICATION/i);
});

test("gives each homepage section its approved accessible emoji", () => {
  const indexHtml = rendered("_pages/about.md");
  const expectedIcons = [
    ["biography", "👤", "Biography"],
    ["news", "📢", "News"],
    ["research-interests", "🎙️", "Research Interests"],
    ["academic-positions", "💼", "Academic Positions"],
    ["education", "🎓", "Education"],
    ["selected-awards", "🏆", "Selected Awards"]
  ];

  for (const [id, emoji, title] of expectedIcons) {
    assert.match(
      indexHtml,
      new RegExp(`<h2 id="${id}"><span class="section-emoji" aria-hidden="true">${emoji}</span> ${title}</h2>`),
      `${title} has its intended decorative emoji and stable fragment ID`
    );
  }

  assert.equal((indexHtml.match(/class="section-emoji" aria-hidden="true"/g) || []).length, 6);
  assert.doesNotMatch(indexHtml, /section-icon|fa-user|fa-bullhorn|fa-microphone-alt/);
});

test("restores homepage news and collapses entries after the newest ten", () => {
  const indexHtml = rendered("_pages/about.md");
  const biographyMatch = /<h2 id="biography">[\s\S]*?<\/h2>\s*<p>([\s\S]*?)<\/p>/.exec(indexHtml);
  const expectedBiography = "Zhe Li is a Postdoctoral Fellow at The University of Hong Kong. His research interests include speech LLMs, robust speaker representation learning, and multimodal artificial intelligence for healthcare applications. He received his Ph.D. in Electrical and Electronic Engineering from The Hong Kong Polytechnic University in 2025, his M.Sc. in Software Engineering from Xinjiang University in 2021, and his B.Eng. in Computer Science from Qilu University of Technology in 2016. He was a research intern at Microsoft Research Asia (MSRA) in 2025 and a visiting Ph.D. researcher in the Department of Electrical Engineering at Stanford University in 2024. He has led two research projects and contributed to a project funded by the Hong Kong Research Grants Council. He has published more than 60 papers in leading speech journals and conferences, including IEEE TASLP, ICASSP, and INTERSPEECH. He holds three granted invention patents and one software copyright. He delivered tutorials on speech large language models at ICME 2026 and INTERSPEECH 2026, and co-organized a special session at ACM MMAsia 2026. He received the 2020 Outstanding Scientific and Technological Achievement Award from the Chinese Association for Artificial Intelligence. His co-authored work received the Best Student Paper Runner-Up Award at PRICAI 2024.";
  const newsHtml = indexHtml.slice(
    indexHtml.indexOf('<h2 id="news">'),
    indexHtml.indexOf('<h2 id="research-interests">')
  );
  const detailsIndex = newsHtml.indexOf('<details class="news-more" markdown="1">');
  const visibleNewsHtml = newsHtml.slice(0, detailsIndex);
  const collapsedNewsHtml = newsHtml.slice(detailsIndex);
  const expectedNews = [
    ["Dec. 2026:", "Special Session on Trustworthy Speech and Audio AI at MMAsia 2026", "https://mmasia2026.org/calls/special-session-trustworthy-speech-audio-ai/"],
    ["Sept. 2026:", "Speech Large Language Models for Under-Resourced Languages", "https://interspeech2026.org/en-AU/pages/programme/tutorials"],
    ["Jul. 2026:", "Speech Large Language Models: Architectures, Efficient Adaptation, and Applications", "https://2026.ieeeicme.org/tutorials/#1766933845252-bb9d3b7e-7e8e"],
    ["Jul. 2026:", "Towards Robust Remote Sensing Visual Question Answering", "https://doi.org/10.1016/j.neunet.2026.109308"],
    ["Jul. 2026:", "STEP: Semantic-Guided Two-Stage Framework"],
    ["Jun. 2026:", "4 papers have been accepted to INTERSPEECH 2026"],
    ["Apr. 2026:", "DB-SMGA: Dual-Branch Sequential Multi-Granularity Attention"],
    ["Apr. 2026:", "Uncertainty-Aware Multi-Head Multi-Mode Knowledge Distillation"],
    ["Apr. 2026:", "Speech Large Language Models for Under-Resourced Languages", "https://interspeech2026.org/en-AU/pages/programme/tutorials"],
    ["Mar. 2026:", "Towards A Unified Perspective on Parameter-Efficient Fine Tuning", "https://doi.org/10.1109/TASLPRO.2026.3682068"],
    ["Jan. 2026:", "Two papers accepted to ICASSP 2026"],
    ["Dec. 2025:", "My First Tutorial!", "https://2026.ieeeicme.org/tutorials/#1766933845252-bb9d3b7e-7e8e"],
    ["Sep. 29, 2025:", "WhisMultiNet: Advancing End-to-End Speech Topic Classification"],
    ["Sep. 4, 2025:", "Disentangling Speech Representations Learning with Latent Diffusion"],
    ["Aug. 20, 2025:", "One paper accepted to EMNLP 2025"],
    ["Jun. 18, 2025:", "One paper accepted to MICCAI 2025"],
    ["Jun. 14, 2025:", "Mutual Information-Enhanced Contrastive Learning with Margin"],
    ["May 19, 2025:", "Two papers accepted to INTERSPEECH 2025"],
    ["Mar. 4, 2025:", "Spectral-Aware Low-Rank Adaptation for Speaker Verification", "https://mp.weixin.qq.com/s/2ju6s77tFD-fhD43D7cDDA"],
    ["Feb. 11, 2025:", "Joined Microsoft Research Asia (MSRA)"],
    ["Dec. 21, 2024:", "Four papers accepted to ICASSP 2025"],
    ["Dec. 4, 2024:", "Best Student Paper Runner-Up Award"],
    ["Jun. 17, 2024:", "Parameter-efficient Fine-tuning of Speaker-Aware Dynamic Prompts", "https://mp.weixin.qq.com/s/1rumaLXfNoLEVM9HZNT3Eg"],
    ["Apr. 3, 2024:", "Dual Parameter-Efficient Fine-Tuning for Speaker Representation", "https://www.bilibili.com/video/BV17T42127Wd?t=47.1"],
    ["Dec. 8, 2023:", "Maximal Speaker Separability via Robust Speaker Representation Learning"],
    ["Dec. 3, 2023:", "International Doctoral Forum 2023"],
    ["May 15, 2023:", "Discriminative Speaker Representation via Contrastive Learning", "https://www.bilibili.com/video/BV1y8411S7Qg?t=3.8"],
    ["Jul. 1, 2022:", "Odyssey-CNSRC Workshop 2022", "https://www.bilibili.com/video/BV18S4y1p7xY?p=8&t=0.9"],
    ["May 29, 2021:", "Completed Master’s oral examination"],
    ["Nov. 14, 2020:", "Outstanding Scientific and Technological Achievement Award", "https://mp.weixin.qq.com/s/HgcGxSYnunYZaDQIU7Tjuw"],
    ["Oct. 29, 2020:", "CCL 2020", "https://hub.baai.ac.cn/view/3391"],
    ["Oct. 11, 2020:", "CCMT 2020", "https://www.bilibili.com/video/BV1PD4y197ma?p=6"]
  ];
  const visibleNewsItems = visibleNewsHtml.match(/<li>[\s\S]*?<\/li>/g) || [];
  const collapsedNewsItems = collapsedNewsHtml.match(/<li>[\s\S]*?<\/li>/g) || [];
  const allNewsItems = [...visibleNewsItems, ...collapsedNewsItems];

  assert.ok(detailsIndex > 0, "older News entries use a details disclosure");
  assert.equal(visibleNewsItems.length, 5);
  assert.equal(collapsedNewsItems.length, 27);
  assert.equal(allNewsItems.length, expectedNews.length);
  for (const [index, [month, item, href]] of expectedNews.entries()) {
    const newsText = allNewsItems[index].replace(/<[^>]+>/g, "").replace(/&amp;/g, "&");
    const newsLinks = [...allNewsItems[index].matchAll(/href="([^"]+)"/g)].map((match) => match[1].replace(/&amp;/g, "&"));
    assert.ok(allNewsItems[index].includes(`<strong>${month}</strong>`), `${month} appears at News position ${index + 1}`);
    assert.ok(newsText.includes(item), `${item} identifies News item ${index + 1}`);
    if (href) assert.ok(newsLinks.includes(href), `${item} retains its supplied link`);
  }

  assert.match(collapsedNewsHtml, /^<details class="news-more" markdown="1">\s*<summary>More<\/summary>/);
  assert.doesNotMatch(collapsedNewsHtml, /^<details[^>]*\sopen(?:\s|>)/);

  assert.doesNotMatch(newsHtml, /<h3/);
  assert.ok(biographyMatch, "Biography paragraph is rendered after its heading");
  assert.equal(biographyMatch[1].replace(/<[^>]+>/g, ""), expectedBiography);
  assert.match(indexHtml, /You are more than what you have become!/);
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
