<template>
  <el-dialog
    title="关注公众号【假装大佬】"
    :visible.sync="show"
    :width="dialogSmallWidth"
    :top="dialogTop"
    :fullscreen="$store.state.miniInterface"
    :class="
      isWebApp && !$store.getters.isNight ? 'status-bar-light-bg-dialog' : ''
    "
    :before-close="cancel"
  >
    <el-image
      :src="require('../assets/imgs/mpcode.jpg')"
      class="qrcode-img"
      fit="cover"
      lazy
    />
  </el-dialog>
</template>

<script>
import { mapGetters } from "vuex";

export default {
  model: {
    prop: "show",
    event: "setShow"
  },
  name: "ReplaceRuleForm",
  data() {
    return {};
  },
  props: ["show"],
  computed: {
    ...mapGetters(["dialogSmallWidth", "dialogTop"])
  },
  methods: {
    cancel() {
      this.$emit("setShow", false);
    }
  }
};
</script>
<style lang="stylus" scoped>
.qrcode-img {
  display: block;
  margin: 0 auto;
}
</style>
