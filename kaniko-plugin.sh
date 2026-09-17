#!/busybox/sh
# 上游 `banzaicloud/drone-kaniko` 的插件脚本（0.6.1，见
# https://github.com/banzaicloud/drone-kaniko/blob/master/plugin.sh），
# 下面标注「本地修改」的两处是必须的补丁。

set -euo pipefail

export PATH=$PATH:/kaniko/

REGISTRY=${PLUGIN_REGISTRY:-index.docker.io}

if [ "${PLUGIN_USERNAME:-}" ] || [ "${PLUGIN_PASSWORD:-}" ]; then
    DOCKER_AUTH=`echo -n "${PLUGIN_USERNAME}:${PLUGIN_PASSWORD}" | base64 | tr -d "\n"`

    cat > /kaniko/.docker/config.json <<DOCKERJSON
{
    "auths": {
        "${REGISTRY}": {
            "auth": "${DOCKER_AUTH}"
        }
    }
}
DOCKERJSON
fi

if [ "${PLUGIN_JSON_KEY:-}" ];then
    echo "${PLUGIN_JSON_KEY}" > /kaniko/gcr.json
    export GOOGLE_APPLICATION_CREDENTIALS=/kaniko/gcr.json
fi

DOCKERFILE=${PLUGIN_DOCKERFILE:-Dockerfile}
CONTEXT=${PLUGIN_CONTEXT:-$PWD}
LOG=${PLUGIN_LOG:-info}
EXTRA_OPTS=""

if [[ -n "${PLUGIN_TARGET:-}" ]]; then
    TARGET="--target=${PLUGIN_TARGET}"
fi

# --- 本地修改 1/3：本地 Dockerfile = 上游 0.6.1 + 这两行 -----------------------
# `--context-sub-path`：上游插件从未透出这个参数，而我们要跳过工作区里的
#   问题文件（见上方 Dockerfile 注释），故把 PLUGIN_BINARY 当作它用。
# `--skip-tls-verify-registry`：对目标制品库关掉证书校验，CNB 内网地址
#   没法用公网证书握手。
if [ -n "${PLUGIN_BINARY:-}" ]; then
    EXTRA_OPTS="--context-sub-path=${PLUGIN_BINARY} --skip-tls-verify-registry=${REGISTRY}"
fi

if [[ "${PLUGIN_SKIP_TLS_VERIFY:-}" == "true" ]]; then
    EXTRA_OPTS="--skip-tls-verify=true"
fi

if [[ "${PLUGIN_CACHE:-}" == "true" ]]; then
    CACHE="--cache=true"
fi

if [ -n "${PLUGIN_BUILD_ARGS:-}" ]; then
    BUILD_ARGS=$(echo "${PLUGIN_BUILD_ARGS}" | tr ',' '\n' | while read build_arg; do echo "--build-arg=${build_arg}"; done)
fi

if [ -n "${PLUGIN_BUILD_ARGS_FROM_ENV:-}" ]; then
    BUILD_ARGS_FROM_ENV=$(echo "${PLUGIN_BUILD_ARGS_FROM_ENV}" | tr ',' '\n' | while read build_arg; do echo "--build-arg ${build_arg}=$(eval "echo \$$build_arg")"; done)
fi

# auto_tag, if set auto_tag: true, auto generate .tags file
# support format Major.Minor.Release or start with `v`
# docker tags: Major, Major.Minor, Major.Minor.Release and latest
if [[ "${PLUGIN_AUTO_TAG:-}" == "true" ]]; then
    TAG=$(echo "${DRONE_TAG:-}" |sed 's/^v//g')
    part=$(echo "${TAG}" |tr '.' '\n' |wc -l)
    # expect number
    echo ${TAG} |grep -E "[a-z-]" &>/dev/null && isNum=1 || isNum=0

    if [ ! -n "${TAG:-}" ];then
        echo "latest" > .tags
    elif [ ${isNum} -eq 1 -o ${part} -gt 3 ];then
        echo "${TAG},latest" > .tags
    else
        major=$(echo "${TAG}" |awk -F'.' '{print $1}')
        minor=$(echo "${TAG}" |awk -F'.' '{print $2}')
        release=$(echo "${TAG}" |awk -F'.' '{print $3}')

        major=${major:-0}
        minor=${minor:-0}
        release=${release:-0}

        echo "${major},${major}.${minor},${major}.${minor}.${release},latest" > .tags
    fi
fi

# --- 本地修改 2/3：无 PLUGIN_TAGS 时可把一个仓库推成多个标签 ----------------
# 上游在 `repo` + `tags` 都给了的情况下只认 `tags`；这里让未给 `tags` 时
# 用 `,` 分隔的 `repo` 当目标列表，配合 `tags` 做一个镜像多个标签。
if [ -n "${PLUGIN_TAGS:-}" ]; then
    DESTINATIONS=$(echo "${PLUGIN_TAGS}" | tr ',' '\n' | while read tag; do echo "--destination=${REGISTRY}/${PLUGIN_REPO}:${tag} "; done)
elif [ -f .tags ]; then
    DESTINATIONS=$(cat .tags| tr ',' '\n' | while read tag; do echo "--destination=${REGISTRY}/${PLUGIN_REPO}:${tag} "; done)
elif [ -n "${PLUGIN_REPO:-}" ]; then
    DESTINATIONS=$(echo "${PLUGIN_REPO}" | tr "," "\n" | while read dest; do echo "--destination=${REGISTRY}/${dest}:${PLUGIN_TAGS:-latest} "; done)
else
    DESTINATIONS="--no-push"
    # Cache is not valid with --no-push
    CACHE=""
fi

# --- 本地修改 3/3：`redo` snapshotter 不丢路径大小写 -------------------------
# 上游只传 `-v info`；这里加 `--snapshot-mode=redo`，原因见 Dockerfile 注释。
/kaniko/executor -v ${LOG} \
    --snapshot-mode=redo \
    --context=${CONTEXT} \
    --dockerfile=${DOCKERFILE} \
    ${EXTRA_OPTS} \
    ${DESTINATIONS} \
    ${CACHE:-} \
    ${TARGET:-} \
    ${BUILD_ARGS:-} \
    ${BUILD_ARGS_FROM_ENV:-}
