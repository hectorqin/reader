<script>
export default {
  name: "pcontent",
  data() {
    return {};
  },
  props: ["carray", "title"],
  render() {
    const { fontSize, fontWeight, fontColor } = this;
    let style = {
      fontSize,
      fontWeight,
      color: fontColor,
      ...this.$store.getters.currentFontFamily,
      ...(this.$store.state.config.contentCSS || {})
    };
    if (this.show) {
      return (
        <div style={style}>
          <h3>{this.title}</h3>
          {this.carray.map(a => {
            a = "&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;&nbsp;" + a.replace(/^\s+/g, "");
            return <p domPropsInnerHTML={a} />;
          })}
        </div>
      );
    } else {
      return <div />;
    }
  },
  computed: {
    show() {
      return this.$store.state.showContent;
    },
    fontSize() {
      return this.$store.state.config.fontSize + "px";
    },
    fontWeight() {
      return this.$store.state.config.fontWeight || undefined;
    },
    fontColor() {
      return this.$store.state.config.fontColor || undefined;
    }
  },
  watch: {
    fontSize() {
      let that = this;
      that.$store.commit("setShowContent", false);
      this.$nextTick(() => {
        that.$store.commit("setShowContent", true);
      });
    }
  }
};
</script>

<style lang="stylus" scoped>
p {
  display: block;
  word-wrap: break-word;
  word-break: break-all;
}
h3 {
    font-size: 1.5em;
    line-height: 1.2;
    margin: 1em 0;
}
</style>
