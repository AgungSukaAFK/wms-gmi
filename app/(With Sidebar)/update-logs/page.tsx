import { getUpdateLogs, markUpdateLogsRead } from "@/services/update-logs-actions";
import { Content } from "@/components/content";
import { ScrollText } from "lucide-react";
import UpdateLogsClient from "./UpdateLogsClient";

export default async function UpdateLogsPage() {
  const result = await getUpdateLogs();

  if (!result.success) {
    return (
      <Content>
        <div className="flex items-center gap-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded bg-primary text-primary-foreground shadow-sm">
            <ScrollText className="h-5 w-5" />
          </div>
          <div>
            <h1 className="text-xl font-bold tracking-tight text-foreground">
              UPDATE LOGS
            </h1>
            <p className="mt-1 text-xs font-medium text-destructive">
              {result.error}
            </p>
          </div>
        </div>
      </Content>
    );
  }

  await markUpdateLogsRead();

  return <UpdateLogsClient initialLogs={result.logs} />;
}
