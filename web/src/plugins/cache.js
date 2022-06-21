export const setCache = (key, value) => {
  value = typeof value === "string" ? value : JSON.stringify(value);
  window.localStorage && window.localStorage.setItem(key, value);
};

export const getCache = (key, defaultVal = null) => {
  let val = defaultVal;
  try {
    val = window.localStorage && window.localStorage.getItem(key);
    if (val === null) {
      return defaultVal;
    }
    if (val) {
      const parseVal = JSON.parse(val);
      if (parseVal !== null) {
        return parseVal;
      }
    }
    return val;
  } catch (error) {
    return val;
  }
};
