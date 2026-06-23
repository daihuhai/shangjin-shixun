import { useState } from "react";
import { downloadFile } from "../../api/client";
import { useAsyncData } from "../../hooks/useAsyncData";
import { exportReport, getReportSummary } from "../../services/appService";
import { LoadState } from "../../ui/LoadState";
import { Panel, Table } from "../../ui/PageBlocks";

function SimpleBarChart({ data = [] }) {
  const safeMax = Math.max(...data.map((item) => item.value), 1);
  return (
    <div className="chart-bars">
      {data.map((item) => (
        <div className="chart-column" key={item.label}>
          <span className="chart-value">{item.value}</span>
          <div className="chart-track">
            <div className="chart-fill" style={{ height: `${Math.max((item.value / safeMax) * 100, 8)}%` }} />
          </div>
          <span className="chart-label">{item.label}</span>
        </div>
      ))}
    </div>
  );
}

export default function ReportsPage() {
  const { data, loading, error } = useAsyncData(getReportSummary, []);
  const [message, setMessage] = useState("");
  const [exporting, setExporting] = useState("");

  async function handleExport(format) {
    setExporting(format);
    setMessage("");
    try {
      const result = await exportReport(format);
      await downloadFile(`/reports/download/${result.filename}`, result.filename);
      setMessage(`已生成 ${format.toUpperCase()} 报表：${result.filename}`);
    } catch (err) {
      setMessage(err.message || "导出失败");
    } finally {
      setExporting("");
    }
  }

  return (
    <LoadState loading={loading} error={error}>
      <div className="content-stack">
        <Panel
          title="报表中心"
          description="统计实训评价结果，支持 Excel / PDF 导出与可视化图表。"
          actions={
            <div className="toolbar">
              <button className="primary-button" type="button" disabled={exporting === "excel"} onClick={() => handleExport("excel")}>
                {exporting === "excel" ? "生成中..." : "导出 Excel"}
              </button>
              <button className="ghost-button" type="button" disabled={exporting === "pdf"} onClick={() => handleExport("pdf")}>
                {exporting === "pdf" ? "生成中..." : "导出 PDF"}
              </button>
            </div>
          }
        >
          <div className="stats-grid">
            <div className="data-card"><span className="eyebrow">累计提交</span><strong>{data?.totalSubmissions ?? 0}</strong></div>
            <div className="data-card"><span className="eyebrow">平均分</span><strong>{data?.averageScore ?? "--"}</strong></div>
          </div>
        </Panel>

        <div className="split-layout">
          <Panel title="成绩分布" description="按分数段统计提交数量。">
            <SimpleBarChart data={data?.distribution || []} />
          </Panel>
          <Panel title="风险分布" description="核查风险等级占比。">
            <SimpleBarChart data={data?.riskStats || []} />
          </Panel>
        </div>

        <Panel title="最近导出记录" description="含快照编号，便于答辩演示追溯。">
          <Table
            columns={["类型", "格式", "文件名", "时间", "操作"]}
            rows={data?.recentExports || []}
            renderRow={(row) => (
              <tr key={row.id}>
                <td>{row.type}</td>
                <td>{row.format}</td>
                <td>{row.filename}</td>
                <td>{row.createdAt?.slice(0, 19).replace("T", " ")}</td>
                <td>
                  <button
                    className="ghost-button"
                    type="button"
                    onClick={() => downloadFile(`/reports/download/${row.filename}`, row.filename)}
                  >
                    下载
                  </button>
                </td>
              </tr>
            )}
          />
        </Panel>

        {message ? <div className="success-text">{message}</div> : null}
      </div>
    </LoadState>
  );
}
