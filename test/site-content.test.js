const { after, before, test } = require("node:test");
const assert = require("node:assert/strict");
const { execFileSync } = require("node:child_process");
const { readFileSync } = require("node:fs");
const { join, resolve } = require("node:path");

const repositoryRoot = resolve(__dirname, "..");

function sourceBody(relativePath) {
  let source;
  try {
    source = readFileSync(join(repositoryRoot, relativePath), "utf8");
  } catch (error) {
    if (error.code === "ENOENT") {
      assert.fail(`required page source exists: ${relativePath}`);
    }
    throw error;
  }
  return source.replace(/^---\r?\n[\s\S]*?\r?\n---\r?\n?/, "");
}

function rendered(relativePath) {
  return execFileSync("/usr/local/bin/pandoc", ["--from", "gfm", "--to", "html"], {
    input: sourceBody(relativePath),
    encoding: "utf8"
  });
}

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
  const teachingHtml = rendered("_teaching/EIE558.md");

  assert.doesNotMatch(indexHtml, />CV</);
  assert.match(tutorialsHtml, /interspeech2026\.org\/en-AU\/pages\/programme\/tutorials/);
  assert.match(tutorialsHtml, /2026\.ieeeicme\.org\/tutorials/);
  assert.doesNotMatch(tutorialsHtml, /mmasia2026/);
  assert.match(serviceHtml, /mmasia2026\.org\/calls\/special-session-trustworthy-speech-audio-ai/);
  assert.doesNotMatch(serviceHtml, /Speech Large Language Models: Architectures/);
  assert.match(talksHtml, /bilibili\.com\/video\/BV17T42127Wd/);
  assert.match(teachingHtml, /Speech Processing and Recognition/);
});
