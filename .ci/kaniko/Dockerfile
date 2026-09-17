# Kaniko 构建机镜像：修复上游插件在 CNB 上的两个坑。
#
# 基础镜像取 `gcr.io/kaniko-project/executor:v1.23.2-debug`，它是上游插件
# `banzaicloud/drone-kaniko` 用的 `debug-v0.19.0` 的唯一后续维护线，只是直接
# 由官方发布、打上了明确版本号。
#
# 问题 1：仓库以 Windows / macOS 客户端为主，工作区里 `web/`、`server/` 这些
# 目录大小写不能丢，但 Windows 上 git 默认把工作区 checkout 成全小写，CNB 直接
# 用这个工作区当构建上下文，且上游插件没有透出 `--context-sub-path`，而
# Kaniko 的默认 snapshotter 只保留完整构建上下文里的全大写路径，于是
# `COPY server/...` 会以 `no such file or directory` 失败。debug 镜像里的
# kaniko 用的是 go-containerregistry 的 `fs` snapshotter，它不做大小写映射。
#
# 解法：用 `--snapshot-mode=redo`（Kaniko 自带的 tar snapshotter，不丢大小写），
# 并设置 `GIT_CLONE_PATH` 让运行时用 git 单独克隆一份工作目录，绕过工作区。
#
# 问题 2：构建要经 `docker.cnb.cool` 拉基础镜像，那是内网地址，容器内带着
# 证书去探测会报 `unexpected EOF`，所以对目标 registry 关掉 TLS 证书校验。
FROM gcr.io/kaniko-project/executor:v1.23.2-debug

# 上游插件脚本 + 上述两处修正。
COPY .ci/kaniko/plugin.sh /kaniko/plugin.sh

# CNB 环境下的默认值：运行时由 CNB 注入与本地构建相同的环境变量。
ENV HOME=/kaniko \
    USER=root \
    SSL_CERT_DIR=/kaniko/ssl/certs \
    DOCKER_CONFIG=/kaniko/.docker/ \
    DOCKER_CREDENTIAL_GCR_CONFIG=/kaniko/.config/gcloud/docker_credential_gcr_config.json

ENTRYPOINT [ "/busybox/sh", "/kaniko/plugin.sh" ]
