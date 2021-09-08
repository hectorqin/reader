if (!window.requestAnimationFrame) {
  window.requestAnimationFrame = function(callback) {
    return setTimeout(callback, 1000 / 60);
  };
}

// 动画执行函数
function Animate(options) {
  var start = Date.now();

  window.requestAnimationFrame(function _animate() {
    // timeFraction 从 0 逐渐增加到 1
    var timeFraction = (Date.now() - start) / options.duration;
    if (timeFraction > 1) timeFraction = 1;

    var progress = options.timing(timeFraction); // 动画当前进度
    options.draw(progress); // 绘制动画

    if (timeFraction < 1) {
      window.requestAnimationFrame(_animate);
    } else {
      options.onEnd && options.onEnd();
    }
  });
}

// 时序函数
Animate.Timings = {
  // 线性函数
  linear: function(timeFraction) {
    return timeFraction;
  },
  // 圆弧函数
  circle: function(timeFraction) {
    return 1 - Math.sin(Math.acos(timeFraction));
  },
  // 圆弧函数（与上一个相同）
  circle2: function(timeFraction) {
    return 1 - (1 - timeFraction ** 2) ** 0.5;
  },
  // 反-弹跳函数
  bounce: function(timeFraction) {
    for (var a = 0, b = 1; (a += b), (b /= 2); ) {
      if (timeFraction >= (7 - 4 * a) / 11) {
        return (
          -Math.pow((11 - 6 * a - 11 * timeFraction) / 4, 2) + Math.pow(b, 2)
        );
      }
    }
  },

  // 幂函数，x 为指数
  power: function(x, timeFraction) {
    return Math.pow(timeFraction, x);
  },
  // 反弹函数，x 为弹性系数
  back: function(x, timeFraction) {
    return Math.pow(timeFraction, 2) * ((x + 1) * timeFraction - x);
  },
  // 伸缩函数，x 为初始范围
  elastic: function(x, timeFraction) {
    return (
      Math.pow(2, 10 * (timeFraction - 1)) *
      Math.cos(((20 * Math.PI * x) / 3) * timeFraction)
    );
  }
};

// 工具函数
Animate.Utils = {
  // 接受时序函数，返回时序函数的反函数
  makeEaseOut: function(timing) {
    return function easeOut(timeFraction) {
      return 1 - timing(1 - timeFraction);
    };
  },
  // 接受时序函数，返回时序函数的 easeInOut 变体
  makeEaseInOut: function(timing) {
    return function easeInOut(timeFraction) {
      if (timeFraction < 0.5) return timing(2 * timeFraction) / 2;
      else return 1 - timing(2 * (1 - timeFraction)) / 2;
    };
  }
};

export default Animate;
