import { useMemo } from "react";
import { Highlight, themes } from "prism-react-renderer";

// ---------- 语言检测 ----------
function detectLanguage(code) {
  const trimmed = code.trim();
  if (/^\s*(CREATE|ALTER|DROP|SELECT|INSERT|UPDATE|DELETE|WITH|BEGIN|DECLARE|USE|SHOW|DESCRIBE|EXPLAIN)\s/i.test(trimmed)) return "sql";
  if (/^\s*(public\s+)?(class|interface|enum|abstract)\s/i.test(trimmed)) return "java";
  if (/^\s*(import|from|package|@|public|private|protected|void|int|String|boolean)/i.test(trimmed) && /;\s*$/.test(trimmed.split("\n")[0])) return "java";
  if (/^\s*(def |class |import |from |if __name__|#\!\/usr\/bin)/.test(trimmed)) return "python";
  if (/^\s*(const |let |var |function |import |export |=>|\$\(document)|console\.log/.test(trimmed)) return "javascript";
  if (/^\s*<\?php/.test(trimmed)) return "php";
  if (/^\s*(#include|using\s+namespace|int\s+main|std::cout|printf)/.test(trimmed)) return "cpp";
  if (/\b(SELECT|INSERT|CREATE|TABLE|FROM|WHERE|INTO|VALUES|UPDATE|SET|DELETE|DROP|ALTER|ADD|COLUMN|PRIMARY|KEY|FOREIGN|REFERENCES|NOT NULL|AUTO_INCREMENT|DEFAULT|COMMENT|UNIQUE|INDEX|CONSTRAINT|CHECK|ON|CASCADE|RESTRICT|JOIN|INNER|LEFT|RIGHT|OUTER|CROSS|GROUP|BY|ORDER|HAVING|LIMIT|OFFSET|UNION|ALL|DISTINCT|AS|OR|AND|NOT|IN|BETWEEN|LIKE|IS|NULL|TRUE|FALSE|EXISTS|CASE|WHEN|THEN|ELSE|END|IF|ELSEIF|WHILE|FOR|DO|REPEAT|LOOP|RETURN|CALL|TRIGGER|PROCEDURE|FUNCTION|VIEW|DATABASE|SCHEMA|TABLESPACE|GRANT|REVOKE|COMMIT|ROLLBACK|SAVEPOINT|LOCK|UNLOCK|SET|SHOW|DESCRIBE|EXPLAIN|ANALYZE|OPTIMIZE|REPAIR|ALTER|RENAME|TRUNCATE|MERGE|UPSERT|REPLACE|INTO|LOAD|DATA|INFILE|OUTFILE|DUMP|RESTORE|BACKUP|PREPARE|EXECUTE|DEALLOCATE|DECLARE|CURSOR|FETCH|OPEN|CLOSE|HANDLER|SIGNAL|RESIGNAL|GET|DIAGNOSTICS|CONDITION|REPEATABLE|READ|WRITE|SERIALIZABLE|UNCOMMITTED|COMMITTED|DEFERRED|IMMEDIATE|EXCLUSIVE|MODE|LEVEL|GLOBAL|SESSION|LOCAL|TEMPORARY|TEMP|UNLOGGED|MATERIALIZED|RECURSIVE|CYCLE|LATERAL|LATERAL|NATURAL|USING|MATCH|AGAINST|FULLTEXT|SPATIAL|GEOMETRY|GEOGRAPHY|POINT|LINESTRING|POLYGON|MULTIPOINT|MULTILINESTRING|MULTIPOLYGON|GEOMETRYCOLLECTION|SRID|ST_|POSTGIS|JSON|XML|ARRAY|ROW|RECORD|SETOF|REFCURSOR|OID|REGCLASS|REGTYPE|REGPROC|ANYELEMENT|ANYARRAY|INTERNAL|LANGUAGE|VOLATILE|STABLE|IMMUTABLE|LEAKPROOF|NOT LEAKPROOF|CALLED ON NULL INPUT|RETURNS NULL ON NULL INPUT|STRICT|COST|ROWS|PARALLEL|SAFE|UNSAFE|RESTRICTED|WINDOW|FRAME|RANGE|ROWS|GROUPS|UNBOUNDED|PRECEDING|FOLLOWING|CURRENT ROW|EXCLUDE|NO OTHERS|TIES|OTHERS|OVER|PARTITION|CLUSTER|DISTRIBUTE|REPLICATE|ROUNDROBIN|HASH|LIST|RANGE|INTERVAL|GENERATED|ALWAYS|STORED|VIRTUAL|IDENTITY|SEQUENCE|OWNED|BY|MINVALUE|MAXVALUE|START|INCREMENT|CACHE|CYCLE|NOCYCLE|NOMAXVALUE|NOMINVALUE|NO CACHE|NO CYCLE|NO MAXVALUE|NO MINVALUE)\b/i.test(code)) return "sql";
  return "text";
}

// ---------- 静态错误诊断 ----------
function diagnoseErrors(code, lang) {
  const errors = [];
  const warnings = [];
  const lines = code.split("\n");

  // 通用检查：未闭合的括号/引号
  let parenStack = [];
  let braceStack = [];
  let bracketStack = [];
  let inSingleQuote = false;
  let inDoubleQuote = false;
  let lineComment = false;
  let blockComment = false;

  lines.forEach((line, idx) => {
    const lineNum = idx + 1;
    // 跳过空行和纯注释行
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("//") || trimmed.startsWith("#") && lang !== "sql") return;

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      const prev = i > 0 ? line[i - 1] : "";

      // 注释处理
      if (lang !== "sql" && ch === "/" && prev === "/") { lineComment = true; break; }
      if (lang === "sql" && ch === "-" && prev === "-") { lineComment = true; break; }
      if (ch === "*" && prev === "/") { blockComment = true; continue; }
      if (ch === "/" && prev === "*") { blockComment = false; continue; }
      if (lineComment || blockComment) continue;

      // 字符串内跳过
      if (ch === "'" && !inDoubleQuote && prev !== "\\") { inSingleQuote = !inSingleQuote; continue; }
      if (ch === '"' && !inSingleQuote && prev !== "\\") { inDoubleQuote = !inDoubleQuote; continue; }
      if (inSingleQuote || inDoubleQuote) continue;

      if (ch === "(") parenStack.push({ ch, line: lineNum });
      else if (ch === ")") { if (parenStack.length) parenStack.pop(); else errors.push({ line: lineNum, type: "error", msg: `多余的右括号 )` }); }
      else if (ch === "{") braceStack.push({ ch, line: lineNum });
      else if (ch === "}") { if (braceStack.length) braceStack.pop(); else errors.push({ line: lineNum, type: "error", msg: `多余的右花括号 }` }); }
      else if (ch === "[") bracketStack.push({ ch, line: lineNum });
      else if (ch === "]") { if (bracketStack.length) bracketStack.pop(); else errors.push({ line: lineNum, type: "error", msg: `多余的右方括号 ]` }); }
    }
  });

  // 未闭合的括号
  parenStack.forEach((item) => errors.push({ line: item.line, type: "error", msg: `未闭合的左括号 (` }));
  braceStack.forEach((item) => errors.push({ line: item.line, type: "error", msg: `未闭合的左花括号 {` }));
  bracketStack.forEach((item) => errors.push({ line: item.line, type: "error", msg: `未闭合的左方括号 [` }));

  // ---- 语言特定检查 ----

  if (lang === "sql") {
    // 检查 CREATE TABLE 是否有主键
    if (/CREATE\s+TABLE/i.test(code) && !/PRIMARY\s+KEY/i.test(code)) {
      warnings.push({ line: 1, type: "warning", msg: "建表语句缺少 PRIMARY KEY 定义" });
    }

    // 检查常见拼写错误
    const sqlTypos = [
      { pattern: /\bCREAT\b/i, fix: "CREATE", msg: "关键字拼写错误：CREAT → CREATE" },
      { pattern: /\bTABALE\b/i, fix: "TABLE", msg: "关键字拼写错误：TABALE → TABLE" },
      { pattern: /\bSELCT\b/i, fix: "SELECT", msg: "关键字拼写错误：SELCT → SELECT" },
      { pattern: /\bFORM\b(?!\s*\()/i, fix: "FROM", msg: "关键字拼写错误：FORM → FROM（注意不是 FORM）" },
      { pattern: /\bWHER\b/i, fix: "WHERE", msg: "关键字拼写错误：WHER → WHERE" },
      { pattern: /\bINSRET\b/i, fix: "INSERT", msg: "关键字拼写错误：INSRET → INSERT" },
      { pattern: /\bINTO\b.*\bVALUSE\b/i, fix: "VALUES", msg: "关键字拼写错误：VALUSE → VALUES" },
      { pattern: /\bDELET\b/i, fix: "DELETE", msg: "关键字拼写错误：DELET → DELETE" },
      { pattern: /\bUPDAT\b/i, fix: "UPDATE", msg: "关键字拼写错误：UPDAT → UPDATE" },
      { pattern: /\bvachar\b/i, fix: "varchar", msg: "类型拼写错误：vachar → varchar" },
      { pattern: /\bvarcahr\b/i, fix: "varchar", msg: "类型拼写错误：varcahr → varchar" },
      { pattern: /\bbigint\b.*\bAUTO_INCREMEN\b/i, fix: "AUTO_INCREMENT", msg: "关键字拼写错误：AUTO_INCREMEN → AUTO_INCREMENT" },
      { pattern: /\bCOMMNET\b/i, fix: "COMMENT", msg: "关键字拼写错误：COMMNET → COMMENT" },
      { pattern: /\bDEFAUL\b/i, fix: "DEFAULT", msg: "关键字拼写错误：DEFAUL → DEFAULT" },
      { pattern: /\bTIMESTAP\b/i, fix: "TIMESTAMP", msg: "关键字拼写错误：TIMESTAP → TIMESTAMP" },
      { pattern: /\bDATETIME\b.*\bCURRENT_TIMESTAP\b/i, fix: "CURRENT_TIMESTAMP", msg: "关键字拼写错误：CURRENT_TIMESTAP → CURRENT_TIMESTAMP" },
      { pattern: /\bNOTNULL\b(?!_)/i, fix: "NOT NULL", msg: "语法错误：NOTNULL 应写作 NOT NULL（需要空格）" },
      { pattern: /\bNULLL\b/i, fix: "NULL", msg: "关键字拼写错误：NULLL → NULL" },
    ];

    lines.forEach((line, idx) => {
      sqlTypos.forEach(({ pattern, fix, msg }) => {
        if (pattern.test(line)) {
          // 避免重复（同一行同一类问题只报一次）
          const exists = errors.some(e => e.line === idx + 1 && e.msg.includes(fix))
            || warnings.some(w => w.line === idx + 1 && w.msg.includes(fix));
          if (!exists) warnings.push({ line: idx + 1, type: "warning", msg });
        }
      });
    });

    // 检查每行末尾是否缺少分号（非最后一行且非注释）
    const nonEmptyLines = code.split("\n").filter(l => l.trim() && !l.trim().startsWith("--") && !l.trim().startsWith("//"));
    nonEmptyLines.slice(0, -1).forEach((line, idx) => {
      const actualLineNum = code.split("\n").indexOf(line) + 1;
      const trimmed = line.trim();
      if (
        !trimmed.endsWith(";")
        && !trimmed.endsWith(",")
        && !trimmed.endsWith("(")
        && !trimmed.endsWith(")")
        && !trimmed.endsWith("--")
        && !trimmed.startsWith("/*")
        && !trimmed.startsWith("*")
        && !/^(CREATE|ALTER|DROP|GRANT|REVOKE|BEGIN|WITH|SET|USE|SHOW|DESCRIBE|EXPLAIN|LOCK|UNLOCK|START|COMMIT|ROLLBACK|SAVEPOINT|PREPARE|DECLARE|IF|ELSE|ELSEIF|WHILE|FOR|LOOP|REPEAT|CASE|WHEN|THEN|END|RETURN|LEAVE|ITERATE|CALL|DO|HANDLER|SIGNAL|RESIGNAL|GET|DIAGNOSTICS)$/i.test(trimmed)
        && trimmed.length > 3
      ) {
        // 排除一些不需要分号的情况
        if (!/^\s*(--|\/\/|#|\/\*)/.test(line)) {
          const exists = warnings.some(w => w.line === actualLineNum && w.msg.includes("分号"));
          if (!exists) warnings.push({ line: actualLineNum, type: "info", msg: "该行末尾可能缺少分号 ;" });
        }
      }
    });

    // 检查字段定义中数据类型与长度格式
    lines.forEach((line, idx) => {
      // varchar/char 没有指定长度
      if (/\b(varchar|char|nvarchar|nchar)\b\s*(?!\()/i.test(line) && !/\b(varchar|char|nvarchar|nchar)\b\s*\(/i.test(line)) {
        const exists = warnings.some(w => w.line === idx + 1 && w.msg.includes("指定长度"));
        if (!exists) warnings.push({ line: idx + 1, type: "warning", msg: `${RegExp.$1} 类型建议指定长度，如 ${RegExp.$1}(255)` });
      }
      // int 类型指定了不合理的长度
      if (/\bint\s*\(\d+\)/i.test(line)) {
        warnings.push({ line: idx + 1, type: "info", msg: "int 类型通常不需要指定长度，直接写 int 即可" });
      }
    });
  }

  if (lang === "java") {
    // 类名大写检查
    const classMatch = code.match(/\bclass\s+(\w+)/);
    if (classMatch && /^[a-z]/.test(classMatch[1])) {
      warnings.push({ line: 1, type: "warning", msg: `类名「${classMatch[1]}」首字母应大写（驼峰命名）` });
    }

    // main 方法签名检查
    if (!/public\s+static\s+void\s+main\s*\(\s*String\s*\[\s*\]\s+\w+\s*\)/.test(code)
      && !/public\s+static\s+void\s+main\s*\(\s*String\s+\.\.\.\s+\w+\s*\)/.test(code)
      && /\bmain\b/.test(code)) {
      warnings.push({ line: 1, type: "warning", msg: "main 方法签名可能不标准，应为 public static void main(String[] args)" });
    }

    // 分号检查
    lines.forEach((line, idx) => {
      const trimmed = line.trim();
      if (
        /^(import|package|return|throw|new\s+\w+|System\.out\.print|System\.err\.print)/.test(trimmed)
        && !trimmed.endsWith(";")
        && !trimmed.endsWith("{")
        && !trimmed.startsWith("//")
        && !trimmed.startsWith("/*")
        && trimmed.length > 2
      ) {
        warnings.push({ line: idx + 1, type: "info", msg: "该行可能缺少分号 ;" });
      }
    });
  }

  if (lang === "python") {
    // 缩进一致性检查（基本）
    const indentSizes = new Set();
    lines.forEach((line) => {
      const match = line.match(/^(\s*)/);
      if (match[1].length > 0) indentSizes.add(match[1].length);
    });
    const indents = Array.from(indentSizes).sort((a, b) => a - b);
    if (indents.length > 3) {
      warnings.push({ line: 1, type: "warning", msg: "代码缩进层级过多或缩进不一致，建议使用4空格统一缩进" });
    }

    // def/class 后面是否有冒号
    lines.forEach((line, idx) => {
      if (/^\s*(def|class|if|elif|else|for|while|with|try|except|finally)\b/.test(line) && !line.includes(":")) {
        warnings.push({ line: idx + 1, type: "error", msg: `${RegExp.$1} 语句后缺少冒号 :` });
      }
    });

    // print 语法（Python 2 vs 3）
    lines.forEach((line, idx) => {
      if (/print\s+[^(]/.test(line.trim())) {
        warnings.push({ line: idx + 1, type: "info", msg: "print 语句使用了 Python 2 语法，Python 3 应为 print(...)" });
      }
    });
  }

  if (lang === "javascript") {
    // 常见错误
    lines.forEach((line, idx) => {
      const trimmed = line.trim();
      // == vs ===
      if (/[=!]==[^=]/.test(line) && !/===/.test(line)) {
        warnings.push({ line: idx + 1, type: "info", msg: "建议使用严格相等 === 而非 ==" });
      }
      // var 建议
      if (/^var\s+/.test(trimmed)) {
        warnings.push({ line: idx + 1, type: "info", msg: "建议使用 let 或 const 替代 var" });
      }
      // console.log 遗留
      if (/console\.log/.test(line)) {
        warnings.push({ line: idx + 1, type: "info", msg: "包含 console.log，提交前请移除调试代码" });
      }
    });
  }

  return { errors, warnings };
}

// ---------- Prism 语言映射 ----------
const PRISM_LANG_MAP = {
  sql: "sql",
  java: "java",
  python: "python",
  javascript: "javascript",
  php: "php",
  cpp: "cpp",
  text: "plaintext",
};

// ---------- 主组件 ----------
export default function CodePreview({ code, maxHeight = "500px" }) {
  const lang = useMemo(() => detectLanguage(code), [code]);
  const diagnosis = useMemo(() => diagnoseErrors(code, lang), [code, lang]);

  const hasIssues = diagnosis.errors.length > 0 || diagnosis.warnings.length > 0;

  return (
    <div className="code-preview-wrapper">
      <div className="code-preview-header">
        <span className="code-lang-badge">{lang.toUpperCase()}</span>
        {hasIssues && (
          <span className={`code-diag-badge ${diagnosis.errors.length > 0 ? "has-errors" : ""}`}>
            {diagnosis.errors.length > 0 ? `${diagnosis.errors.length} 个错误` : null}
            {diagnosis.warnings.length > 0 ? `${diagnosis.warnings.length} 个警告` : null}
          </span>
        )}
      </div>

      <div className="code-preview-body" style={{ maxHeight }}>
        <Highlight theme={themes.githubLight} code={code} language={PRISM_LANG_MAP[lang] || "plaintext"}>
          {({ style, tokens, getLineProps, getTokenProps }) => (
            <pre style={{ ...style, margin: 0, padding: "12px 16px", fontSize: "13px", lineHeight: "1.7", background: "#fff" }} className="code-highlight-pre">
              {tokens.map((line, i) => {
                const lineNum = i + 1;
                const lineErrors = diagnosis.errors.filter(e => e.line === lineNum);
                const lineWarnings = diagnosis.warnings.filter(w => w.line === lineNum);

                return (
                  <div key={i} {...getLineProps({ line })} className={`code-line ${lineErrors.length > 0 ? "code-line-error" : ""} ${lineWarnings.length > 0 ? "code-line-warning" : ""}`}>
                    <span className="code-line-number">{lineNum}</span>
                    <span className="code-line-content">
                      {tokens[i].map((token, key) => (
                        <span key={key} {...getTokenProps({ token })} />
                      ))}
                    </span>
                    {(lineErrors.length > 0 || lineWarnings.length > 0) && (
                      <div className="code-line-diags">
                        {[...lineErrors, ...lineWarnings].map((diag, di) => (
                          <span key={di} className={`code-diag-item code-diag-${diag.type}`}>
                            {diag.type === "error" ? "✗" : diag.type === "warning" ? "⚠" : "ℹ"} {diag.msg}
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </pre>
          )}
        </Highlight>
      </div>

      {/* 诊断摘要面板 */}
      {hasIssues && (
        <div className="code-diag-summary">
          {diagnosis.errors.length > 0 && (
            <div className="code-diag-section code-diag-error-section">
              <strong>静态诊断 - 错误 ({diagnosis.errors.length})</strong>
              {diagnosis.errors.map((e, i) => (
                <div key={i} className="code-diag-row">
                  <span className="code-diag-line">第{e.line}行</span>
                  <span>{e.msg}</span>
                </div>
              ))}
            </div>
          )}
          {diagnosis.warnings.length > 0 && (
            <div className="code-diag-section code-diag-warn-section">
              <strong>静态诊断 - 警告 ({diagnosis.warnings.length})</strong>
              {diagnosis.warnings.map((w, i) => (
                <div key={i} className="code-diag-row">
                  <span className="code-diag-line">第{w.line}行</span>
                  <span>{w.msg}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
