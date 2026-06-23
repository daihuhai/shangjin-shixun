import { useAsyncData } from "../../hooks/useAsyncData";
import { getUserAdminData } from "../../services/appService";
import { LoadState } from "../../ui/LoadState";
import { Panel, Table } from "../../ui/PageBlocks";
import { statusTone } from "./shared";

export default function UsersPage() {
  const { data, loading, error } = useAsyncData(getUserAdminData, []);

  return (
    <LoadState loading={loading} error={error}>
      <div className="content-stack">
        <div className="split-layout">
          <Panel title="学生管理" description="按院系 / 年级 / 班级层级管理学生账号。">
            <Table
              columns={["姓名", "组织", "角色", "状态"]}
              rows={data?.students || []}
              renderRow={(row) => (
                <tr key={`${row.name}-${row.role}`}>
                  <td>{row.name}</td>
                  <td>{row.organization}</td>
                  <td>{row.role}</td>
                  <td><span className={`status-chip status-${statusTone(row.status)}`}>{row.status}</span></td>
                </tr>
              )}
            />
          </Panel>

          <Panel title="教师 / 管理员" description="管理教师账号、子管理员与权限分级。">
            <Table
              columns={["姓名", "组织", "角色", "状态"]}
              rows={[...(data?.teachers || []), ...(data?.admins || [])]}
              renderRow={(row) => (
                <tr key={`${row.name}-${row.role}`}>
                  <td>{row.name}</td>
                  <td>{row.organization}</td>
                  <td>{row.role}</td>
                  <td><span className={`status-chip status-${statusTone(row.status)}`}>{row.status}</span></td>
                </tr>
              )}
            />
          </Panel>
        </div>

        <div className="split-layout">
          <Panel title="组织架构管理" description="维护学院、专业、班级树形结构。">
            <div className="callout-stack">
              {(data?.organizationTree || []).map((item) => (
                <div className="input-like" key={item}>{item}</div>
              ))}
            </div>
          </Panel>

          <Panel title="操作日志 / 审核管理" description="查看管理员操作记录与审核流程。">
            <Table
              columns={["操作", "执行人", "时间"]}
              rows={data?.logs || []}
              renderRow={(row) => (
                <tr key={`${row.action}-${row.time}`}>
                  <td>{row.action}</td>
                  <td>{row.actor}</td>
                  <td>{row.time}</td>
                </tr>
              )}
            />
          </Panel>
        </div>
      </div>
    </LoadState>
  );
}
