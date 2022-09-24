const OpenCC = require('opencc-js');

export const traditionalized = function(orgStr) {
  const converter = OpenCC.Converter({ from: 'cn', to: 'tw' });
  return converter(orgStr);
};

export const simplized = function(orgStr) {
  const converter = OpenCC.Converter({ from: 'tw', to: 'cn' });
  return converter(orgStr);
};
