#![cfg_attr(
  all(not(debug_assertions), target_os = "windows"),
  windows_subsystem = "windows"
)]

mod cmds;
mod utils;

use crate::utils::resolve;
use crate::utils::help;
use crate::utils::dirs;
use tauri::{api, CustomMenuItem, Manager, Menu, MenuEntry, MenuItem, Submenu};

fn prepare_menu() -> Menu {
  let mut menu = Menu::os_default("");
  // println!("{:?}", menu);
  let mut menu_items = Vec::<MenuEntry>::new();
  for item in menu.items {
    match item {
      MenuEntry::Submenu(sub) => {
        // 隐藏 Edit 和 File 菜单
        menu_items.push(MenuEntry::Submenu(sub));
        // if !sub.title.eq("Edit") {
        // }
      }
      _ => menu_items.push(item),
    }
  }
  // 插入到 Window 目录之前
  menu_items.insert(menu_items.len() - 1, MenuEntry::Submenu(Submenu::new(
    "Command",
    Menu::new().add_item(
      CustomMenuItem::new("edit_config", "编辑配置").into(),
    ).add_native_item(
      MenuItem::Separator
    ).add_item(
      CustomMenuItem::new("github", "Github").into(),
    ).add_item(
      CustomMenuItem::new("join_tg", "TG频道").into(),
    ).add_item(
      CustomMenuItem::new("tutorial", "官方教程").into(),
    ),
  )));

  println!("{:?}", menu_items);
  menu = Menu::with_items(menu_items);
  return menu;
}

fn main() {
  let menu = prepare_menu();
  let app = tauri::Builder::default()
    .menu(menu)
    .on_menu_event(|event| {
      match event.menu_item_id() {
        "edit_config" => {
          log_if_err!(help::open_file(dirs::config_path()));
        }
        "github" => {
          // open in browser (requires the `shell-open-api` feature)
          api::shell::open(
            &event.window().shell_scope(),
            "https://github.com/hectorqin/reader".to_string(),
            None,
          )
          .unwrap();
        }
        "join_tg" => {
          // open in browser (requires the `shell-open-api` feature)
          api::shell::open(
            &event.window().shell_scope(),
            "https://t.me/+pQ8HDlANPZ84ZWNl".to_string(),
            None,
          )
          .unwrap();
        }
        "tutorial" => {
          // open in browser (requires the `shell-open-api` feature)
          api::shell::open(
            &event.window().shell_scope(),
            "https://mp.weixin.qq.com/mp/appmsgalbum?__biz=MjM5MzMyMDgyMA==&action=getalbum&album_id=2397535253763801090&subscene=app".to_string(),
            None,
          )
          .unwrap();
        }
        id => {
          // do something with other events
          println!("got menu event: {}", id);
        }
      }
    })
    .setup(|app| Ok(resolve::resolve_setup(app)))
    .invoke_handler(tauri::generate_handler![
      cmds::print_log,
      cmds::get_config,
      cmds::save_config,
      cmds::check_java,
    ])
    .build(tauri::generate_context!())
    .expect("error while building tauri application");

  app.run(|_app_handle, e| match e {
    tauri::RunEvent::Ready { .. } => {}
    tauri::RunEvent::WindowEvent { label: _, event, .. } => {
      match event {
        tauri::WindowEvent::CloseRequested { api: _, .. } => {
          // api.prevent_close();
        }
        _ => {}
      };
    }
    tauri::RunEvent::ExitRequested { api: _, .. } => {
      // api.prevent_exit();
    }
    tauri::RunEvent::Exit => {
      api::process::kill_children();
    }
    _ => {}
  });

  // tauri::Builder::default()
  //   .run(tauri::generate_context!())
  //   .expect("error while running tauri application");
}
