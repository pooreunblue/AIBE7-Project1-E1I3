document.addEventListener("DOMContentLoaded", initAlbum);

async function initAlbum() {
  const uploadForm = document.querySelector("#upload-form");
  const imageListContainer = document.querySelector("#image-list");

  if (uploadForm) {
    uploadForm.addEventListener("submit", handleUpload);
  }

  await renderImageList(imageListContainer);
}

async function handleUpload(event) {
  event.preventDefault();

  const fileInput = event.target.querySelector("#image-file");
  const file = fileInput.files[0];

  if (!file) {
    showToast("업로드할 이미지를 선택해주세요.");
    return;
  }

  const ext = file.name.split('.').pop();
  const safeName = `${crypto.randomUUID()}.${ext}`;

  try {
    const session = readSBSession();
    if (!session?.access_token) {
      showToast("로그인이 필요합니다.");
      return;
    }

    const res = await fetch(
      `https://porvghadkgpamnvbuyqu.supabase.co/storage/v1/object/image/${safeName}`,
      {
        method: "POST",
        headers: {
          apikey: "sb_publishable_cpvF4f7QZzxK16Q_-JNM5A_czghLSxK",
          Authorization: `Bearer ${session.access_token}`,
        },
        body: file,
      },
    );

    if (!res.ok) {
      const errText = await res.text();
      console.error("업로드 에러:", res.status, errText);
      if (errText.includes("Bucket not found")) {
        showToast("Supabase Storage에 'image' 버킷을 먼저 생성해 주세요.");
      } else if (errText.includes("row-level security") || res.status === 401 || res.status === 403) {
        showToast("업로드 권한이 없습니다. Supabase Storage 'image' 버킷의 RLS를 비활성화해 주세요.");
      } else {
        showToast("이미지 업로드에 실패했습니다.");
      }
      return;
    }

    showToast("사진이 업로드되었습니다.");
    event.target.reset();

    // localStorage에 기록 (새로고침 fallback)
    addAlbumImage(safeName);

    // 업로드된 이미지를 목록에 직접 추가
    const container = document.querySelector("#image-list");
    if (container.querySelector(".text-muted")) container.innerHTML = "";
    appendImageCard(container, safeName);

  } catch (err) {
    console.error("예외 발생:", err);
  }
}

async function renderImageList(container) {
  try {
    const session = readSBSession();
    if (!session?.access_token) return;

    const res = await fetch(
      "https://porvghadkgpamnvbuyqu.supabase.co/storage/v1/object/list/image",
      {
        method: "POST",
        headers: {
          apikey: "sb_publishable_cpvF4f7QZzxK16Q_-JNM5A_czghLSxK",
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ prefix: "", limit: 100, offset: 0 }),
      },
    );

    if (!res.ok) {
      const errText = await res.text();
      console.error("목록 조회 에러:", errText);
      // 리스트 API 실패 시 localStorage fallback
      renderFromLocalStorage(container);
      return;
    }

    const imageList = await res.json();

    if (!imageList || imageList.length === 0) {
      // API는 성공했으나 목록이 비어있으면 localStorage 확인
      const local = getAlbumList();
      if (local.length) {
        container.innerHTML = "";
        local.forEach(name => appendImageCard(container, name));
        return;
      }
      container.innerHTML = "<p class='text-muted text-center'>업로드된 이미지가 없습니다.</p>";
      return;
    }

    container.innerHTML = "";

    for (const image of imageList) {
      if (image.name === ".emptyFolderPlaceholder") continue;
      // API에서 가져온 이미지도 localStorage에 기록 (차후 fallback 대비)
      addAlbumImage(image.name);
      appendImageCard(container, image.name);
    }
  } catch (err) {
    console.error("렌더링 예외 발생:", err);
    renderFromLocalStorage(container);
  }
}

// localStorage에서 이미지 목록을 가져와 렌더링
function renderFromLocalStorage(container) {
  const names = getAlbumList();
  if (!names.length) {
    container.innerHTML = "<p class='text-muted text-center'>업로드된 이미지가 없습니다.</p>";
    return;
  }
  container.innerHTML = "";
  names.forEach(name => appendImageCard(container, name));
}

// 이미지 카드 하나를 생성해 container에 추가
function appendImageCard(container, name) {
  const publicUrl = "https://porvghadkgpamnvbuyqu.supabase.co/storage/v1/object/public/image/" + name;
  const colDiv = document.createElement("div");
  colDiv.className = "col-6 col-md-4";
  colDiv.innerHTML = `
    <div class="card album-card h-100">
      <img src="${publicUrl}" class="album-img" alt="${name}" loading="lazy"
           onerror="this.alt='이미지를 불러올 수 없습니다';this.style.filter='grayscale(1)';">
      <div class="card-body p-2 text-center">
        <small class="text-muted text-truncate d-block">${name}</small>
        <button class="btn btn-sm btn-outline-danger mt-1 image-delete" data-name="${name}">삭제</button>
      </div>
    </div>
  `;
  colDiv.querySelector(".image-delete").addEventListener("click", () => {
    handleImageDelete(name, colDiv);
  });
  container.append(colDiv);
}

// localStorage 읽기/쓰기 헬퍼
const ALBUM_KEY = "motrip:album:images";

function getAlbumList() {
  try {
    return JSON.parse(localStorage.getItem(ALBUM_KEY) || "[]");
  } catch {
    return [];
  }
}

function addAlbumImage(name) {
  const list = getAlbumList();
  if (!list.includes(name)) {
    list.push(name);
    localStorage.setItem(ALBUM_KEY, JSON.stringify(list));
  }
}

function removeAlbumImage(name) {
  const list = getAlbumList().filter(n => n !== name);
  localStorage.setItem(ALBUM_KEY, JSON.stringify(list));
}

async function handleImageDelete(name, colDiv) {
  if (!confirm("이 이미지를 삭제하시겠습니까?")) return;

  try {
    const session = readSBSession();
    if (!session?.access_token) {
      showToast("로그인이 필요합니다.");
      return;
    }

    const res = await fetch(
      `https://porvghadkgpamnvbuyqu.supabase.co/storage/v1/object/image/delete`,
      {
        method: "POST",
        headers: {
          apikey: "sb_publishable_cpvF4f7QZzxK16Q_-JNM5A_czghLSxK",
          Authorization: `Bearer ${session.access_token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({ prefixes: [name] }),
      },
    );

    if (!res.ok) {
      const errText = await res.text();
      console.error("삭제 에러:", res.status, errText);
      if (errText.includes("row-level security") || res.status === 401 || res.status === 403) {
        showToast("삭제 권한이 없습니다. Supabase Storage 'image' 버킷의 RLS를 확인해 주세요.");
      } else if (res.status === 404) {
        showToast("파일을 찾을 수 없습니다.");
      } else {
        showToast("삭제에 실패했습니다.");
      }
      return;
    }

    colDiv.remove();
    removeAlbumImage(name);
    showToast("이미지가 삭제되었습니다.");

    // 목록이 비었으면 안내 메시지 표시
    const container = document.querySelector("#image-list");
    if (container && !container.children.length) {
      container.innerHTML = "<p class='text-muted text-center'>업로드된 이미지가 없습니다.</p>";
    }
  } catch (err) {
    console.error("삭제 예외 발생:", err);
    showToast("삭제 중 오류가 발생했습니다.");
  }
}
