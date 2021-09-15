<script>
export default {
  name: "pcontent",
  data() {
    return {};
  },
  props: ["carray", "title", "showContent"],
  render() {
    const { fontSize, fontWeight, fontColor } = this;
    const style = {
      fontSize,
      fontWeight,
      color: fontColor,
      ...this.$store.getters.currentFontFamily,
      ...(this.$store.state.config.contentCSS || {})
    };
    const pStyle = {
      lineHeight: this.$store.state.config.lineHeight,
      margin:
        typeof this.$store.state.config.paragraphSpace !== "undefined"
          ? this.$store.state.config.paragraphSpace + "em"
          : null
    };
    if (this.showContent) {
      return (
        <div style={style}>
          <h3>{this.title}</h3>
          {this.carray.map(a => {
            a = a.replace(/^\s+/g, "");
            return <p style={pStyle} domPropsInnerHTML={a} />;
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
    // fontSize() {
    //   this.$store.commit("setShowContent", false);
    //   this.$nextTick(() => {
    //     this.$store.commit("setShowContent", true);
    //   });
    // }
  }
};
</script>

<style lang="stylus" scoped>
p {
  display: block;
  word-wrap: break-word;
  word-break: break-all;
  text-indent: 2em;
}
h3 {
    font-size: 28px;
    line-height: 1.2;
    margin: 1em 0;
}
</style>
