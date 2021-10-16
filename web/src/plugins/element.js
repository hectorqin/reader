import Vue from "vue";
import {
  Button,
  Divider,
  MessageBox,
  Message,
  Breadcrumb,
  BreadcrumbItem,
  Table,
  TableColumn,
  Popover,
  Loading,
  Input,
  Select,
  Option,
  Tag,
  Collapse,
  CollapseItem,
  Dialog,
  Checkbox,
  CheckboxGroup,
  ColorPicker,
  Slider,
  Form,
  FormItem,
  Switch,
  Link,
  RadioGroup,
  RadioButton,
  Pagination,
  InputNumber,
  Image,
  Badge
} from "element-ui";

Vue.use(Button);
Vue.use(Divider);
Vue.use(Breadcrumb);
Vue.use(BreadcrumbItem);
Vue.use(Table);
Vue.use(TableColumn);
Vue.use(Popover);
Vue.use(Input);
Vue.use(Select);
Vue.use(Option);
Vue.use(Tag);
Vue.use(Loading.directive);
Vue.use(Collapse);
Vue.use(CollapseItem);
Vue.use(Dialog);
Vue.use(Checkbox);
Vue.use(CheckboxGroup);
Vue.use(ColorPicker);
Vue.use(Slider);
Vue.use(Form);
Vue.use(FormItem);
Vue.use(Switch);
Vue.use(Link);
Vue.use(RadioGroup);
Vue.use(RadioButton);
Vue.use(Pagination);
Vue.use(InputNumber);
Vue.use(Image);
Vue.use(Badge);

Vue.prototype.$msgbox = MessageBox;
Vue.prototype.$message = Object.assign({}, Message, {
  info(message, duration) {
    const options = typeof message === "string" ? { message } : message;
    options.duration = duration || 1000;
    Message.info(options);
  },
  error(message, duration) {
    const options = typeof message === "string" ? { message } : message;
    options.duration = duration || 2000;
    Message.error(options);
  },
  success(message, duration) {
    const options = typeof message === "string" ? { message } : message;
    options.duration = duration || 1000;
    Message.success(options);
  }
});
Vue.prototype.$ELEMENT = {
  zIndex: 2100
};
Vue.prototype.$alert = MessageBox.alert;
Vue.prototype.$confirm = MessageBox.confirm;
Vue.prototype.$prompt = MessageBox.prompt;
Vue.prototype.$loading = Loading.service;
