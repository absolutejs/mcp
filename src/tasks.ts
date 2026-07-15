import type { McpTask, McpTaskStore } from "./types";

const clone = <Value>(value: Value): Value => structuredClone(value);

export const createMemoryMcpTaskStore = (): McpTaskStore => {
  const tasks = new Map<string, McpTask>();

  return {
    cancel: (taskId) => {
      const task = tasks.get(taskId);
      if (task === undefined) return;
      tasks.set(taskId, {
        ...task,
        lastUpdatedAt: new Date().toISOString(),
        status: "cancelled",
      });
    },
    get: (taskId) => {
      const task = tasks.get(taskId);

      return task === undefined ? null : clone(task);
    },
    save: (task) => {
      tasks.set(task.taskId, clone(task));
    },
    update: (taskId, update) => {
      const task = tasks.get(taskId);
      if (task === undefined) return null;
      if (["cancelled", "completed", "failed"].includes(task.status)) {
        return clone(task);
      }
      const next: McpTask = {
        ...task,
        ...update,
        lastUpdatedAt: new Date().toISOString(),
      };
      tasks.set(taskId, next);

      return clone(next);
    },
  };
};

export const publicMcpTask = ({ authorizationKey, ...task }: McpTask) => {
  void authorizationKey;

  return task;
};
