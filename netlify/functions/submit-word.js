// Menggunakan Octokit untuk berinteraksi dengan GitHub API
const { Octokit } = require("@octokit/rest");
const fetch = require("node-fetch");

// Ambil variabel rahasia dari Netlify Environment
const { GITHUB_TOKEN, GITHUB_REPO, GITHUB_USER } = process.env;

// Nama file database di repo kamu
const DB_PATH = "database.json";

exports.handler = async (event) => {
  // 1. Cek jika ini bukan POST request, tolak.
  if (event.httpMethod !== "POST") {
    return {
      statusCode: 405,
      body: JSON.stringify({ message: "Method Not Allowed" }),
    };
  }

  try {
    // 2. Ambil data dari form user
    const newData = JSON.parse(event.body);
    const { kata, bahasa, arti } = newData;

    // Validasi sederhana
    if (!kata || !bahasa || !arti) {
      return {
        statusCode: 400,
        body: JSON.stringify({ message: "Semua field wajib diisi." }),
      };
    }

    // 3. Inisialisasi GitHub API
    const octokit = new Octokit({ auth: GITHUB_TOKEN });

    // --- PROSES MEMBUAT PULL REQUEST ---

    // 4. Dapatkan branch 'main' (atau 'master') terbaru
    const mainBranch = await octokit.rest.git.getRef({
      owner: GITHUB_USER,
      repo: GITHUB_REPO,
      ref: "heads/main", // Ganti 'main' jika nama branch kamu 'master'
    });
    const mainSha = mainBranch.data.object.sha;

    // 5. Buat nama branch baru yang unik untuk usulan ini
    // --- PERBAIKAN DIMULAI DISINI ---
    // SANITASI: Nama branch Git tidak boleh mengandung spasi atau karakter aneh.
    // Kita ganti spasi dengan '-' dan hapus karakter selain huruf/angka/strip
    const safeBahasa = bahasa
      .toLowerCase()
      .replace(/\s+/g, "-") // Ganti spasi (atau lebih) dengan 1 strip
      .replace(/[^a-z0-9-]/g, ""); // Hapus semua yg bukan huruf, angka, atau strip

    const safeKata = kata
      .toLowerCase()
      .replace(/\s+/g, "-")
      .replace(/[^a-z0-9-]/g, "");

    const newBranchName = `usulan/${safeBahasa}-${safeKata}-${Date.now()}`;
    // --- PERBAIKAN SELESAI ---

    // 6. Buat branch baru dari 'main'
    await octokit.rest.git.createRef({
      owner: GITHUB_USER,
      repo: GITHUB_REPO,
      ref: `refs/heads/${newBranchName}`,
      sha: mainSha,
    });

    // 7. Ambil konten database.json yang SEKARANG
    const dbFile = await octokit.rest.repos.getContent({
      owner: GITHUB_USER,
      repo: GITHUB_REPO,
      path: DB_PATH,
      ref: "heads/main", // Ambil dari main
    });

    const content = Buffer.from(dbFile.data.content, "base64").toString(
      "utf-8"
    );
    const dbData = JSON.parse(content);

    // 8. Tambahkan kata baru ke data
    dbData.push(newData);

    // 9. Commit file database.json yang baru ke BRANCH BARU
    await octokit.rest.repos.createOrUpdateFileContents({
      owner: GITHUB_USER,
      repo: GITHUB_REPO,
      path: DB_PATH,
      message: `Menambahkan kata baru: ${kata} (${bahasa})`,
      content: Buffer.from(JSON.stringify(dbData, null, 2), "utf-8").toString(
        "base64"
      ),
      sha: dbFile.data.sha, // SHA dari file lama (penting!)
      branch: newBranchName, // Commit ke branch baru
    });

    // 10. Buat Pull Request!
    const pr = await octokit.rest.pulls.create({
      owner: GITHUB_USER,
      repo: GITHUB_REPO,
      title: `[Usulan Kata] ${kata} (${bahasa})`,
      head: newBranchName, // Dari branch baru
      base: "main", // Ke branch main
      body: `User mengusulkan kata baru:
- **Bahasa:** ${bahasa}
- **Kata:** ${kata}
- **Arti:** ${arti}
            
Mohon di-review, Miyamura!`,
    });

    // 11. Beri respons sukses ke user
    return {
      statusCode: 200,
      body: JSON.stringify({
        message: "Usulan berhasil dikirim dan Pull Request telah dibuat!",
        pr_url: pr.data.html_url,
      }),
    };
  } catch (error) {
    console.error("Error di Netlify Function:", error);
    return {
      statusCode: 500,
      body: JSON.stringify({
        message: "Terjadi kesalahan internal di server.",
        error: error.message,
      }),
    };
  }
};
