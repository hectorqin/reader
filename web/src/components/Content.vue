<script>
export default {
  name: "pcontent",
  data() {
    return {};
  },
  props: ["content", "title", "showContent"],
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
      marginTop:
        typeof this.$store.state.config.paragraphSpace !== "undefined"
          ? this.$store.state.config.paragraphSpace + "em"
          : null,
      marginBottom:
        typeof this.$store.state.config.paragraphSpace !== "undefined"
          ? this.$store.state.config.paragraphSpace + "em"
          : null
    };
    if (this.showContent) {
      let wordCount = this.title.length + 2; // 2为两个换行符
      return (
        <div style={style}>
          <h3 data-pos={0}>{this.title}</h3>
          {this.content.split(/\n+/).map(a => {
            a = a.replace(/^\s+/g, "");
            const pos = wordCount;
            wordCount += a.length + 2; // 2为两个换行符
            return <p style={pStyle} domPropsInnerHTML={a} data-pos={pos} />;
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
p.reading {
  color: red !important;
}
h3 {
    font-size: 28px;
    line-height: 1.2;
    margin: 1em 0;
}
h3.reading {
  color: red !important;
}
</style>
