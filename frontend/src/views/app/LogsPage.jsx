import { useAsyncData } from "../../hooks/useAsyncData";
import { getLogs } from "../../services/appService";
import { LoadState } from "../../ui/LoadState";
import { Panel } from "../../ui/PageBlocks";

export default function LogsPage() {
  const { data, loading, error } = useAsyncData(getLogs, []);

  return (
    <LoadState loading={loading} error={error}>
      <Panel title="系统日志" description="系统日志页面已切到接口拉取模式。">
        <div className="timeline">
          {(data || []).map((item) => (
            <div className="timeline-item" key={`${item.time}-${item.title}`}>
              <span>{item.time}</span>
              <div>
                <strong>{item.title}</strong>
                <br />
                <span>{item.description}</span>
              </div>
            </div>
          ))}
        </div>
      </Panel>
    </LoadState>
  );
}
