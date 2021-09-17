import Axios from "axios";
import { Message, MessageBox } from "element-ui";
import store from "./vuex";

const service = Axios.create({
  baseURL: store.getters.api,
  withCredentials: true,
  timeout: 3 * 60 * 1000
});

service.interceptors.request.use(
  config => config,
  error => {
    // console.log(error); // for debug
    return Promise.reject(error);
  }
);

service.interceptors.response.use(
  response => {
    return response;
  },
  error => {
    return Promise.reject(error);
  }
);

export const request = async ({
  url,
  method = "get",
  params = {},
  data = {},
  headers = {},
  options = {},
  alert
}) => {
  // post 默认显示返回的信息
  if (alert === undefined) {
    alert = method === "post";
  }
  if (store.state.token) {
    params.accessToken = store.state.token;
  }
  if (store.state.isSecureMode && store.state.secureKey) {
    params.secureKey = store.state.secureKey;
    params.userNS = store.state.userNS;
  }
  const query = {
    url,
    method,
    headers,
    params,
    data,
    ...options
  };
  const response = await service(query);
  if (!response) {
    return;
  }
  const res = response.data;

  const { isSuccess, errorMsg } = res;
  if (!isSuccess) {
    let result;
    switch (res.data) {
      case "NEED_LOGIN":
        // 需要登录
        store.commit("setShowLogin", true);
        setTimeout(() => {
          errorMsg && Message.error({ message: errorMsg, duration: 2000 });
        }, 200);
        break;
      case "NEED_SECURE_KEY":
        result = await MessageBox.prompt(
          "请输入管理密码后继续操作",
          "操作确认"
        );
        if (result && result.action === "confirm" && result.value) {
          params.secureKey = result.value;
          store.commit("setSecureKey", result.value);
          return await request({
            url,
            method,
            params,
            data,
            headers,
            alert
          });
        }
        break;
      default:
        errorMsg && Message.error({ message: errorMsg, duration: 2000 });
        break;
    }
  } else {
    alert && errorMsg && Message.success({ message: errorMsg, duration: 1500 });
  }

  return response;
};

request.get = async (url, options) => {
  options = options || {};
  return await request({
    url,
    method: "get",
    params: options.params || {},
    options
  });
};

request.post = async (url, data, options) => {
  return await request({
    url,
    data,
    method: "post",
    options
  });
};

export default request;
