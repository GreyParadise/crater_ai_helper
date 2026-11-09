# 节点「账号占用」功能验证（2026-11-09）

页面：`/admin/cluster/nodes` → 行操作 → 「账户占有 / 取消独占」

## 机制

- 占用 = 给节点打污点 `crater.raids.io/account=<账号名>:NoSchedule`
  （另写注解 `crater.raids.io/taint-reason-occupied`、`crater.raids.io/taint-operator-occupied`）
- 释放 = 精确删除该污点（后端按 key+value+effect 匹配），同时清掉两个注解
- 调度侧：作业创建时带 `Toleration{key=crater.raids.io/account, Equal, value=<自己的账号名>, NoSchedule}`，
  所以独占节点只允许该账号的作业调度；**default（公共账户）不加容忍，因此用不了独占节点**

## 实测（用 llm004，该节点 0 个用户作业，验证后立即释放）

| 步骤 | 结果 |
| --- | --- |
| 占用前 | 列表状态「运行中」，菜单为「账户占有 / 排空节点 / 禁止调度」 |
| UI 选账号「显卡共享」+ 填原因 → 提交 | toast「节点占有成功」 |
| 集群侧 | `taints=[{key:crater.raids.io/account, value:q-4, effect:NoSchedule}]`，注解含原因与操作人 |
| 列表展示 | 状态变「已占用」，显示账号昵称「显卡共享」；菜单变「取消独占」 |
| 取消独占 → 提交 | 弹窗「要取消 显卡共享 的占有吗？」→ toast「取消节点占有成功」 |
| 释放后 | 污点与注解均清除，状态回「运行中」；四个节点最终 `taints=None` |

结论：**占用 / 释放 / 状态展示 / 污点内容均正常**。

## 顺手修掉的一个隐患

释放分支原先把"显示用的昵称"直接当作污点 value 提交：

```ts
setSelectedAccount(occupiedAccountNickname)  // 可能是「显卡共享」
```

而昵称来自 `getNicknameByName` 的**异步缓存**：首次调用返回 undefined（回退到账号名，所以第一次操作通常是好的），
缓存热了之后返回昵称。列定义一旦重建（例如 `resources` 查询刷新导致 useMemo 重算），
点击「取消独占」就会拿「显卡共享」去匹配污点 → 后端 `taint ... not found`，释放失败。

修法（`routes/admin/cluster/nodes/index.tsx`）：新增 `selectedAccountLabel` 只做弹窗展示，
提交给后端的一律是污点里的原始 value（账号名 `q-4`）。