import { getIdToken } from "./auth.js";

export async function apiFetch(url, options = {}) {
  // Lấy token của người dùng đang đăng nhập
  const token = await getIdToken();

  // Lấy các header có sẵn, nếu không có thì tạo mới
  const headers = new Headers(options.headers);

  // Gắn token để backend xác thực người dùng
  headers.set("Authorization", `Bearer ${token}`);

  // Nếu có body và chưa khai báo Content-Type thì mặc định dùng JSON
  if (options.body && !headers.has("Content-Type")) {
    headers.set("Content-Type", "application/json");
  }

  // Gửi request đến backend
  return fetch(url, {
    ...options,
    headers
  });
}