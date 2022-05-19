export const setCache = (key, value) => {
  value = typeof value === "string" ? value : JSON.stringify(value);
  window.localStorage && window.localStorage.setItem(key, value);
};

export const getCache = (key, defaultVal = null) => {
  try {
    let val = window.localStorage && window.localStorage.getItem(key);
    if (val === null) {
      return defaultVal;
    }
    if (val) {
      val = JSON.parse(val);
    }
    return val;
  } catch (error) {
    return defaultVal;
  }
};
