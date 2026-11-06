/**
 * 组：images —— 镜像查询 / 构建 / 共享 / 删除
 *
 * 对应接口：docs/api-inventory.md §2.5（images 路由表）+ §3.4（请求体结构体）
 * 实测矩阵：docs/verified-routes.md（本组只封装「实测存在」或「清单已明确登记」的路径）
 *
 * 三条必须知道的事实（写工具 / 用工具时都别绕开）：
 * 1. 构建是**异步长任务**：POST /images/{kaniko,dockerfile,envd} 只是把构建任务提交给后端，
 *    后端再起 kaniko Pod 真正构建（几十分钟很常见）。要进度/结果必须用
 *    crater_images_kaniko_list / crater_images_kaniko_detail / crater_images_kaniko_pod 去查，
 *    失败原因只在 kaniko 构建日志里，接口本身不会告诉你为什么失败。
 * 2. 构建产物落在「我自己」的 Harbor 项目里，**占用 crater_images_quota 的用量**；同一 name+tag
 *    重复构建可能互相覆盖，长期堆积会顶满配额导致后续构建失败。
 * 3. `GET /api/v1/images/arch`、`GET /api/v1/images/tags` 这类「读」路由**不存在**（实测 404），
 *    架构/标签只有 POST 改写路由；镜像架构只能从镜像列表条目里读。
 *
 * 不含：`/api/v1/admin/images/**`（属 admin 组，且需要 rolePlatform=3）。
 */
import { z } from "zod";
import { defaultFormat, type ToolSpec } from "../registry.js";

/** 三个构建接口共用的「目标镜像」字段（键名严格取自 §3.4 的 JSON tag，不能改） */
const targetImageShape = {
  name: z
    .string()
    .min(1)
    .describe("目标镜像名（JSON 字段 name），只写镜像名本身、不带 Harbor 地址与 tag，例如 my-torch"),
  tag: z
    .string()
    .min(1)
    .describe("目标标签（JSON 字段 tag），例如 v1、py310-cu124；同名镜像重构建请换 tag，否则会互相覆盖"),
  description: z.string().optional().describe("镜像描述，会显示在镜像列表里"),
  tags: z.array(z.string()).optional().describe("镜像检索标签（≠ tag，与目标 tag 是两回事）"),
  template: z
    .string()
    .optional()
    .describe("构建模板标识；不确定就留空（可从 crater_images_kaniko_detail 看已有镜像用的模板）"),
  archs: z
    .array(z.string())
    .optional()
    .describe('目标架构列表，如 ["amd64"]；写多个（多架构构建）会显著变慢'),
};

const buildHint = (kind: string) =>
  `已提交 ${kind} 构建任务（异步，不是构建完成）。真实进度请用 crater_images_kaniko_list 或 crater_images_kaniko_detail 轮询；` +
  `构建 Pod 的节点信息用 crater_images_kaniko_pod。构建可能耗时几十分钟，成功后镜像会计入 crater_images_quota 的配额用量，失败原因只能看 kaniko 构建日志。`;

export const specs: ToolSpec[] = [
  // ============================ 查询类（只读） ============================
  {
    name: "crater_images_list",
    group: "images",
    title: "我可用的镜像列表",
    description:
      "列出「我可用的镜像」：公共镜像 + 本账号镜像 + 我上传的私有镜像 + 别人分享给我的镜像（响应为 {imageList:[...]}）。" +
      "每个元素含 ID（注意字段名是大写 ID）、imageLink（完整镜像地址）、imagepackName（构建时提交的镜像名）、taskType、archs、" +
      "imageShareStatus、isPublic 与 userInfo.username（owner），创建作业前先用它拿准确的镜像标识，不要凭记忆拼镜像名。" +
      "注意：返回混合了多种来源，改描述/改标签/删除这类操作只对 userInfo.username 是自己的镜像生效。",
    method: "GET",
    path: "/api/v1/images/image",
    scope: "account",
    readOnly: true,
    input: {},
  },
  {
    name: "crater_images_available",
    group: "images",
    title: "按任务类型列可选镜像",
    description:
      "按作业类型（jupyter / webide / training / pytorch / tensorflow / custom）列出平台允许该类型使用的镜像，用于创建作业时挑镜像。" +
      "type 为空时后端可能返回全部类型，若报 validate failed 再补上 type。" +
      "注意：这个是「该任务类型可用」集合，和「我有权限使用」的交集才是你真正能选的镜像。",
    method: "GET",
    path: "/api/v1/images/available",
    scope: "account",
    readOnly: true,
    input: {
      type: z
        .string()
        .optional()
        .describe("作业类型（JobType），如 jupyter、webide、training、pytorch、tensorflow、custom；不传通常返回全部"),
    },
    query: ["type"],
  },
  {
    name: "crater_images_cuda_base",
    group: "images",
    title: "CUDA 基础镜像列表",
    description:
      "返回平台登记的 CUDA 基础镜像条目（label / value，例如『CUDA 12.4 + Ubuntu 22.04』）。" +
      "构建镜像（envd 的 base、kaniko 的 image）或挑基础环境时先用它，别自己编 base 镜像名。" +
      "注意：这是平台管理员维护的参考清单，不一定等于 Harbor 里真实存在可拉取的镜像。",
    method: "GET",
    path: "/api/v1/images/cudabaseimage",
    scope: "self",
    readOnly: true,
    input: {},
  },
  {
    name: "crater_images_kaniko_list",
    group: "images",
    title: "我的镜像构建任务列表",
    description:
      "列出我提交过的镜像构建任务（kaniko records）：镜像链接、目标镜像名、状态、创建时间等。" +
      "构建是异步的，提交后用它轮询进度；想取消或清理记录用 crater_images_kaniko_cancel。" +
      "注意：这里只有「任务记录」，构建失败的具体原因要看 kaniko 构建日志，接口里通常只有状态。",
    method: "GET",
    path: "/api/v1/images/kaniko",
    scope: "self",
    readOnly: true,
    input: {},
  },
  {
    name: "crater_images_kaniko_detail",
    group: "images",
    title: "按镜像包名查构建详情",
    description:
      "按镜像包名（imagePackName，即构建时提交的 name、也是列表响应里的 imagepackName 字段）取某个构建/镜像的详情：状态、dockerfile、构建 Pod 名、架构、标签等。" +
      "排查「镜像到底构建成功没有」时优先用它，比列表更详细。" +
      "注意：query 参数名是 name（§3.4 `GET /images/getbyname | query name (required)`），必须是镜像名而不是完整 imageLink，也不是 tag。",
    method: "GET",
    path: "/api/v1/images/getbyname",
    scope: "self",
    readOnly: true,
    input: {
      name: z.string().min(1).describe("镜像包名（构建时提交的 name，不是 tag、不是完整镜像地址）"),
    },
    query: ["name"],
  },
  {
    name: "crater_images_kaniko_pod",
    group: "images",
    title: "查构建 Pod 名/命名空间/节点",
    description:
      "按构建任务 ID 返回该次构建对应的 Pod 名、命名空间、所在节点，便于定位构建卡住/被驱逐是哪个节点的问题。" +
      "注意：只有构建任务仍有 Pod（构建中或刚结束）时才有信息；拿到 Pod 名后如需看日志请去平台界面或集群侧，" +
      "本 MCP 不封装 k8s 级日志接口。",
    method: "GET",
    path: "/api/v1/images/podname",
    scope: "self",
    readOnly: true,
    input: {
      id: z.number().int().describe("构建任务 ID（kaniko 记录的 ID，可从 crater_images_kaniko_list 拿）"),
    },
    query: ["id"],
  },
  {
    name: "crater_images_quota",
    group: "images",
    title: "我的 Harbor 项目用量与配额",
    description:
      "返回我的镜像仓库（Harbor 项目）的已用空间 used、配额 quota、项目名 project、总量 total（对象，不是分页列表），构建镜像前先看还有没有余量。" +
      "注意：每次构建都会往项目里推镜像并占用空间，配额满了构建会直接失败；删镜像（crater_images_delete）后空间需要等 Harbor 回收。",
    method: "GET",
    path: "/api/v1/images/quota",
    scope: "account",
    readOnly: true,
    input: {},
  },
  {
    name: "crater_images_harbor",
    group: "images",
    title: "查 Harbor 地址",
    description:
      "返回平台 Harbor 仓库地址（ip 字段，形如 https://x.x.x.x:port）。" +
      "拼完整镜像地址（Harbor地址/项目名/镜像名:tag）、或者让别人 docker pull 时用得到。" +
      "注意：这里只给地址，不含账号密码；仓库账号密码属敏感凭据，本组不提供接口。",
    method: "GET",
    path: "/api/v1/images/harbor",
    scope: "self",
    readOnly: true,
    input: {},
  },
  {
    name: "crater_images_share_granted",
    group: "images",
    title: "查镜像已共享给谁",
    description:
      "按镜像 ID 返回该镜像当前已授权的用户列表与账号列表（userList / accountList）。" +
      "分享（crater_images_share）前后用它确认授权对象，取消分享（crater_images_unshare）前也用它拿到要撤销的 ID。" +
      "注意：只能查自己有权限的镜像；imageID 必填，不传会报 validate failed。",
    method: "GET",
    path: "/api/v1/images/share",
    scope: "self",
    readOnly: true,
    input: { imageID: z.number().int().describe("镜像 ID（从 crater_images_list 的 ID 字段取）") },
    query: ["imageID"],
  },
  {
    name: "crater_images_share_ungranted_users",
    group: "images",
    title: "搜可共享的用户（尚未授权）",
    description:
      "按镜像 ID + 用户名关键字，搜索「还没被授权」的用户，用于决定 crater_images_share 里 idList 该填哪些用户 ID。" +
      "注意：返回的是用户 ID，不是用户名；分享给账号请改用 crater_images_share_ungranted_accounts。",
    method: "GET",
    path: "/api/v1/images/user",
    scope: "self",
    readOnly: true,
    input: {
      imageID: z.number().int().describe("要分享的镜像 ID"),
      name: z.string().optional().describe("用户名关键字（模糊匹配）；不传一般返回全部未授权用户"),
    },
    query: ["imageID", "name"],
  },
  {
    name: "crater_images_share_ungranted_accounts",
    group: "images",
    title: "列可共享的账号（尚未授权）",
    description:
      "按镜像 ID 列出「还没被授权」的账号（项目）列表，用于 crater_images_share(type=account) 挑选 idList。" +
      "注意：账号级分享会让该账号内所有成员都能用这个镜像，慎用；先确认账号名与 ID 的对应关系。",
    method: "GET",
    path: "/api/v1/images/account",
    scope: "self",
    readOnly: true,
    input: { imageID: z.number().int().describe("要分享的镜像 ID") },
    query: ["imageID"],
  },

  // ============================ 构建类（写） ============================
  {
    name: "crater_images_build_kaniko",
    group: "images",
    title: "用 pip/apt 增量构建镜像",
    description:
      "基于一个已有源镜像，叠加 pip requirements 与 apt 包，构建出新镜像（平台没有独立的 pip-apt 路由，pip/apt 安装就走这个接口）。" +
      "必填 image（源镜像）、name（目标镜像名）、tag；requirements 传 pip requirements 文本（一行一个包），packages 传空格分隔的 apt 包名。" +
      "注意：构建异步且耗时长，会占用 crater_images_quota 的仓库配额；源镜像必须是我能拉到的（公共/本账号/已共享），" +
      "构建失败只能看 kaniko 构建日志，常见原因是包名写错、网络拉不到源镜像、配额满。",
    method: "POST",
    path: "/api/v1/images/kaniko",
    scope: "self",
    readOnly: false,
    input: {
      image: z.string().min(1).describe("源镜像（JSON 字段 image），可用完整地址或 crater_images_list 里的 imageLink"),
      requirements: z
        .string()
        .optional()
        .describe("pip requirements 文本，一行一个（如 torch==2.4.0\\nnumpy>=1.26）；不装 pip 包就留空"),
      packages: z.string().optional().describe("apt 包名，空格分隔（如 vim git curl）；不装系统包就留空"),
      ...targetImageShape,
    },
    body: "all",
    format: (data) => `${buildHint("kaniko（pip/apt）")}\n\n${defaultFormat(data)}`,
  },
  {
    name: "crater_images_build_dockerfile",
    group: "images",
    title: "用 Dockerfile 构建镜像",
    description:
      "提交完整 Dockerfile 文本构建新镜像，适合 pip/apt 之外的自定义步骤（COPY 文件、环境变量、多阶段构建）。" +
      "必填 dockerfile、name、tag；建议 base 用 crater_images_cuda_base 里的条目，别写死拉不到的镜像。" +
      "注意：Dockerfile 里 FROM 的镜像必须平台可达；构建同样异步、耗时、占配额，失败只能看 kaniko 构建日志。",
    method: "POST",
    path: "/api/v1/images/dockerfile",
    scope: "self",
    readOnly: false,
    input: {
      dockerfile: z.string().min(1).describe("完整 Dockerfile 文本（JSON 字段 dockerfile），必须含 FROM"),
      ...targetImageShape,
    },
    body: "all",
    format: (data) => `${buildHint("Dockerfile")}\n\n${defaultFormat(data)}`,
  },
  {
    name: "crater_images_build_envd",
    group: "images",
    title: "用 envd 脚本构建镜像",
    description:
      "提交 envd 构建脚本（envd 字段）+ python 版本 + base 基础镜像来构建镜像；把「在 WebIDE/Jupyter 里装好的环境」打成镜像时最常用这一步，" +
      "但 envd 只负责构建：要打包运行中环境里装过的包，请先把这些包写进 envd 脚本（或改用 crater_images_build_kaniko 的 requirements）。" +
      "前置：envd 脚本必须以 `# syntax=v1` 开头（格式不对后端直接失败）、base 先用 crater_images_cuda_base 选、name/tag 必填且要唯一。" +
      "注意：构建异步、耗时长（几十分钟）、占配额；失败细节只在 kaniko 构建日志里。",
    method: "POST",
    path: "/api/v1/images/envd",
    scope: "self",
    readOnly: false,
    input: {
      envd: z.string().min(1).describe("envd 构建脚本全文（JSON 字段 envd），须含 `# syntax=v1` 首行"),
      python: z.string().optional().describe("python 版本，例如 3.10；不传则由 base/脚本决定"),
      base: z
        .string()
        .optional()
        .describe("基础镜像（JSON 字段 base），建议从 crater_images_cuda_base 选，如 CUDA 12.4 + Ubuntu 22.04 对应的 value"),
      ...targetImageShape,
    },
    body: "all",
    format: (data) => `${buildHint("envd")}\n\n${defaultFormat(data)}`,
  },
  {
    name: "crater_images_register",
    group: "images",
    title: "登记一个已有镜像链接",
    description:
      "把已经存在（在别处构建好、已推进仓库）的镜像地址登记进平台，供创建作业时选择，不做任何构建。" +
      "必填 imageLink（完整镜像地址）与 taskType（jupyter/webide/training…）。" +
      "注意：平台通常不会真的去拉取校验，链接写错要到启动作业时才暴露；登记前可用 crater_images_harbor 拼地址。",
    method: "POST",
    path: "/api/v1/images/image",
    scope: "self",
    readOnly: false,
    input: {
      imageLink: z.string().min(1).describe("完整镜像地址，例如 <harbor地址>/<项目>/<镜像名>:<tag>"),
      taskType: z
        .string()
        .min(1)
        .describe("任务类型（JobType），如 jupyter、webide、training、pytorch、tensorflow、custom"),
      description: z.string().optional().describe("镜像描述"),
      tags: z.array(z.string()).optional().describe("镜像检索标签"),
      archs: z.array(z.string()).optional().describe('镜像架构列表，如 ["amd64"]'),
    },
    body: "all",
  },

  // ============================ 维护类（写） ============================
  {
    name: "crater_images_update_description",
    group: "images",
    title: "改镜像描述",
    description:
      "修改某个镜像的描述。只能改自己作为 owner 的镜像，改别人的会被后端拒绝（requireImageOwner）。" +
      "必填 id 与 description；想把描述清空就传空字符串。" +
      "注意：这是整体覆盖该字段，不是追加；不确定当前 description 时先 crater_images_list 看一眼。",
    method: "POST",
    path: "/api/v1/images/description",
    scope: "self",
    readOnly: false,
    input: {
      id: z.number().int().describe("镜像 ID（crater_images_list 返回的元素里字段名是大写 ID，如 10）"),
      description: z.string().describe("新的镜像描述（整体覆盖；传空串即清空）"),
    },
    body: ["id", "description"],
  },
  {
    name: "crater_images_update_tags",
    group: "images",
    title: "改镜像标签",
    description:
      "整体覆盖某个镜像的检索标签（tags 数组）。只能改自己拥有的镜像。" +
      "注意：tags 是覆盖语义不是追加——要保留旧标签就把旧标签一起传进来（先 crater_images_list 查当前值）；" +
      "它和镜像的目标 tag（:tag）不是一回事。",
    method: "POST",
    path: "/api/v1/images/tags",
    scope: "self",
    readOnly: false,
    input: {
      id: z.number().int().describe("镜像 ID"),
      tags: z.array(z.string()).describe("新的标签数组（整体覆盖旧值）"),
    },
    body: ["id", "tags"],
  },
  {
    name: "crater_images_update_arch",
    group: "images",
    title: "改镜像架构列表",
    description:
      "整体覆盖某个镜像记录的架构列表（archs，如 [\"amd64\"]）。只能改自己拥有的镜像，id 与 archs 都必填。" +
      "注意：这里只改平台里的元数据记录，**不会**真的重新构建多架构镜像；" +
      "乱填会导致作业调度时选错架构而拉取失败。",
    method: "POST",
    path: "/api/v1/images/arch",
    scope: "self",
    readOnly: false,
    input: {
      id: z.number().int().describe("镜像 ID"),
      archs: z.array(z.string()).describe('架构列表，如 ["amd64"] 或 ["amd64","arm64"]（整体覆盖）'),
    },
    body: ["id", "archs"],
  },
  {
    name: "crater_images_update_task_type",
    group: "images",
    title: "改镜像任务类型",
    description:
      "修改镜像适用的任务类型（jupyter / webide / training / pytorch / tensorflow / custom），决定它出现在哪类作业的镜像下拉里。" +
      "只能改自己拥有的镜像。" +
      "注意：改错类型后该镜像可能在作业创建页「消失」，用 crater_images_available 验证改动是否符合预期。",
    method: "POST",
    path: "/api/v1/images/type",
    scope: "self",
    readOnly: false,
    input: {
      id: z.number().int().describe("镜像 ID"),
      taskType: z
        .string()
        .min(1)
        .describe("新的任务类型（JobType），如 jupyter、webide、training、pytorch、tensorflow、custom"),
    },
    body: ["id", "taskType"],
  },
  {
    name: "crater_images_quota_update",
    group: "images",
    title: "改 Harbor 项目存储配额",
    description:
      "把「我」的 Harbor 镜像项目存储配额改成 size（整数，单位与 crater_images_quota 返回的 quota 一致，实测为 GB 量级，最大不超过平台上限）。" +
      "配额满了就构建不出镜像，所以扩容后才好继续构建。" +
      "注意：这是账号资源上限，改小会让现有镜像超出配额、后续构建直接失败；先 crater_images_quota 看 used 再决定。",
    method: "POST",
    path: "/api/v1/images/quota",
    scope: "account",
    readOnly: false,
    input: {
      size: z.number().int().min(1).describe("新的配额大小（整数），请对照 crater_images_quota 返回的 quota 单位填写"),
    },
    body: ["size"],
  },
  {
    name: "crater_images_share",
    group: "images",
    title: "共享镜像给用户或账号",
    description:
      "把自己的镜像分享给别人：imageID 指定镜像，idList 指定被分享对象 ID 列表，type 决定对象是用户（user）还是账号（account）。" +
      "前置：先用 crater_images_share_ungranted_users（用户）或 crater_images_share_ungranted_accounts（账号）拿到尚未授权的 ID。" +
      "注意：分享给账号 = 该账号全体成员都能用，权限面很大；分享不改变归属，对方不能删你的镜像，但你可以随时取消（crater_images_unshare）。",
    method: "POST",
    path: "/api/v1/images/share",
    scope: "self",
    readOnly: false,
    input: {
      imageID: z.number().int().describe("要分享的镜像 ID（必须是自己拥有的镜像）"),
      idList: z.array(z.number().int()).min(1).describe("被分享对象的 ID 列表（type=user 时是用户 ID，type=account 时是账号 ID）"),
      type: z.enum(["user", "account"]).describe("分享对象类型：user=指定用户，account=整个账号（项目）"),
    },
    body: ["imageID", "idList", "type"],
  },
  {
    name: "crater_images_unshare",
    group: "images",
    title: "取消镜像共享",
    description:
      "撤销某个镜像对某个用户或账号的授权。id 是被撤销的授权对象 ID（用户 ID 或账号 ID），imageID 是镜像 ID，type 与分享时一致。" +
      "前置：用 crater_images_share_granted 查到当前已授权的 userList / accountList 再填。" +
      "注意：撤销后对方立刻无法再用该镜像启动作业，已在运行的作业不受影响。",
    method: "DELETE",
    path: "/api/v1/images/share",
    scope: "self",
    readOnly: false,
    input: {
      imageID: z.number().int().describe("镜像 ID"),
      id: z.number().int().describe("要撤销的授权对象 ID（用户 ID 或账号 ID）"),
      type: z.enum(["user", "account"]).describe("授权对象类型：user 或 account（与分享时保持一致）"),
    },
    body: ["imageID", "id", "type"],
  },

  // ============================ 删除类（写 + destructive） ============================
  {
    name: "crater_images_delete",
    group: "images",
    title: "批量删除我的镜像",
    description:
      "按 ID 列表批量删除自己拥有的镜像（后端逐个校验 owner）。用它可以一次清理多个镜像、腾出 Harbor 配额。" +
      "注意：删除**不可恢复**，且可能连带影响引用该镜像的历史作业/他人共享（先用 crater_images_share_granted 确认共享情况）；" +
      "空间回收有延迟，删完 crater_images_quota 的 used 不会立刻下降。",
    method: "POST",
    path: "/api/v1/images/deleteimage",
    scope: "self",
    readOnly: false,
    destructive: true,
    input: {
      idList: z.array(z.number().int()).min(1).describe("要删除的镜像 ID 列表（必须是自己的镜像；ID 取自列表元素的大写 ID 字段，idList 为必填）"),
    },
    body: ["idList"],
    format: (data) => `删除请求已提交（镜像不可恢复）。\n\n${defaultFormat(data)}`,
  },
  {
    name: "crater_images_delete_one",
    group: "images",
    title: "按 ID 删除单个镜像",
    description:
      "按路径中的镜像 ID 删除单个镜像（仅 owner 可用），是 crater_images_delete 的单条版本，调用语义更直观。" +
      "注意：删除**不可恢复**；若只是想取消一次构建任务记录，别用这个，用 crater_images_kaniko_cancel。",
    method: "DELETE",
    path: "/api/v1/images/image/:id",
    scope: "self",
    readOnly: false,
    destructive: true,
    input: { id: z.number().int().describe("镜像 ID（crater_images_list 返回元素里的大写 ID 字段）") },
    pathParams: ["id"],
  },
  {
    name: "crater_images_kaniko_cancel",
    group: "images",
    title: "删除/取消构建任务记录",
    description:
      "按构建任务 ID 删除（取消）我的一条 kaniko 构建记录，用于清理构建失败留下的垃圾记录。" +
      "注意：它删除的是**构建任务记录**，不等于删除已构建出来的镜像（后者用 crater_images_delete）；" +
      "操作不可恢复；若构建仍在进行中，进度查询会随之消失。",
    method: "POST",
    path: "/api/v1/images/remove",
    scope: "self",
    readOnly: false,
    destructive: true,
    input: { id: z.number().int().describe("构建任务 ID（crater_images_kaniko_list 里的 ID 字段）") },
    body: ["id"],
    format: (data) => `构建任务记录已删除（不可恢复）。如需删除已构建出的镜像，请用 crater_images_delete。\n\n${defaultFormat(data)}`,
  },
];
