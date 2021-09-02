<template>
  <div id="app">
    <router-view></router-view>
  </div>
</template>

<script>
export default {
  name: "app",
  components: {},
  beforeCreate() {
    // console.log(this);
    var config = JSON.parse(localStorage.getItem("config"));
    if (config != null) this.$store.commit("setConfig", config);
    this.$store.commit("setMiniInterface", window.innerWidth < 750);
    window.onresize = () => {
      this.$store.commit("setMiniInterface", window.innerWidth < 750);
    };
  }
};
</script>

<style>
#app {
  font-family: "Avenir", Helvetica, Arial, sans-serif;
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
  color: #2c3e50;
  margin: 0;
  height: 100%;
}
</style>
<style lang="stylus">
.popper-component {
  top: 0 !important;
}
@media screen and (max-width: 750px) {
  .popper-component {
    top: 0 !important;
    left: 0 !important;
    width: 100vw !important;
    box-sizing: border-box;
    margin: 0 !important;
  }
}
</style>
