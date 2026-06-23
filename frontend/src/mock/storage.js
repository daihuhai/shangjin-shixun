const DB_KEY = "chaoxing-style-mock-db";
const AUTH_KEY = "chaoxing-style-auth";
const OLD_NAME = "戴祐豪";
const NEW_NAME = "戴祜豪";

const seededUsers = [
  {
    id: "teacher-001",
    name: "戴祜豪",
    username: "teacher",
    password: "teacher123",
    role: "teacher",
    organization: "软件工程学院"
  },
  {
    id: "student-001",
    name: "陈晓雯",
    username: "student",
    password: "student123",
    role: "student",
    organization: "软件 2301"
  },
  {
    id: "admin-001",
    name: "平台管理员",
    username: "admin",
    password: "admin123",
    role: "admin",
    organization: "教务处"
  }
];

function initDb() {
  const raw = localStorage.getItem(DB_KEY);
  if (raw) {
    const parsed = JSON.parse(raw);
    const normalized = normalizeDb(parsed);
    localStorage.setItem(DB_KEY, JSON.stringify(normalized));
    return normalized;
  }

  const initial = normalizeDb({});
  localStorage.setItem(DB_KEY, JSON.stringify(initial));
  return initial;
}

function normalizeDb(db) {
  const users = Array.isArray(db?.users)
    ? db.users.map((user) => migrateLegacyName(user))
    : [];
  const teacherCourseWorkspace = typeof db?.teacherCourseWorkspace === "object" && db.teacherCourseWorkspace !== null
    ? db.teacherCourseWorkspace
    : {};

  seededUsers.forEach((seedUser) => {
    const exists = users.some((user) => user.username === seedUser.username && user.role === seedUser.role);
    if (!exists) {
      users.push(seedUser);
    }
  });

  return { users, teacherCourseWorkspace };
}

function migrateLegacyName(user) {
  if (!user || typeof user !== "object") {
    return user;
  }

  return user.name === OLD_NAME ? { ...user, name: NEW_NAME } : user;
}

export function readDb() {
  return initDb();
}

export function writeDb(db) {
  localStorage.setItem(DB_KEY, JSON.stringify(db));
}

export function readAuth() {
  const raw = localStorage.getItem(AUTH_KEY);
  if (!raw) {
    return null;
  }

  const parsed = JSON.parse(raw);
  const migrated = parsed?.user
    ? { ...parsed, user: migrateLegacyName(parsed.user) }
    : migrateLegacyName(parsed);

  if (JSON.stringify(parsed) !== JSON.stringify(migrated)) {
    localStorage.setItem(AUTH_KEY, JSON.stringify(migrated));
  }

  return migrated;
}

export function writeAuth(data) {
  if (data) {
    const normalized = data?.user
      ? { ...data, user: migrateLegacyName(data.user) }
      : migrateLegacyName(data);
    localStorage.setItem(AUTH_KEY, JSON.stringify(normalized));
  } else {
    localStorage.removeItem(AUTH_KEY);
  }
}

export function resetMockData() {
  localStorage.removeItem(DB_KEY);
  localStorage.removeItem(AUTH_KEY);
  return initDb();
}
