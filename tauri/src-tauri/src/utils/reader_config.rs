use crate::utils::{config, dirs, tmpl};
use anyhow::Result;
use serde::{Deserialize, Serialize};
use serde_yaml::Mapping;

/// ### `config.yaml` schema
#[derive(Default, Debug, Clone, Deserialize, Serialize)]
pub struct ReaderConfig {
  #[serde(skip_serializing_if = "Option::is_none", rename = "javaPath")]
  pub java_path: Option<String>,

  #[serde(skip_serializing_if = "Option::is_none", rename = "serverPort")]
  pub server_port: Option<u64>,

  /// enable debug mode
  #[serde(skip_serializing_if = "Option::is_none")]
  pub debug: Option<bool>,

  /// whether to remember window size
  #[serde(skip_serializing_if = "Option::is_none", rename = "rememberSize")]
  pub remember_size: Option<bool>,

  /// whether to remember window position
  #[serde(skip_serializing_if = "Option::is_none", rename = "rememberPosition")]
  pub remember_position: Option<bool>,

  /// window postionX
  #[serde(skip_serializing_if = "Option::is_none", rename = "width")]
  pub width: Option<f64>,

  /// window postionY
  #[serde(skip_serializing_if = "Option::is_none", rename = "height")]
  pub height: Option<f64>,

  /// window postionX
  #[serde(skip_serializing_if = "Option::is_none", rename = "positionX")]
  pub position_x: Option<f64>,

  /// window postionY
  #[serde(skip_serializing_if = "Option::is_none", rename = "positionY")]
  pub position_y: Option<f64>,

  /// whether to set window size when start
  #[serde(skip_serializing_if = "Option::is_none", rename = "setWindowSize")]
  pub set_window_size: Option<bool>,

  /// whether to set window position when start
  #[serde(skip_serializing_if = "Option::is_none", rename = "setWindowPosition")]
  pub set_window_position: Option<bool>,

  /// server config
  #[serde(skip_serializing_if = "Option::is_none", rename = "serverConfig")]
  pub server_config: Option<Mapping>,
}

impl ReaderConfig {
  pub fn new() -> Self {
    config::read_yaml::<ReaderConfig>(dirs::config_path())
  }

  /// Save Reader App Config
  pub fn save_file(&self) -> Result<()> {
    config::save_yaml(
      dirs::config_path(),
      self,
      Some(tmpl::READER_CONFIG_COMMENT),
    )
  }

  /// patch reader config
  /// only save to file
  pub fn patch_config(&mut self, patch: ReaderConfig) -> Result<()> {
    // only change it
    if patch.java_path.is_some() {
      self.java_path = patch.java_path;
    }
    if patch.server_port.is_some() {
      self.server_port = patch.server_port;
    }
    if patch.debug.is_some() {
      self.debug = patch.debug;
    }
    if patch.remember_size.is_some() {
      self.remember_size = patch.remember_size;
    }
    if patch.remember_position.is_some() {
      self.remember_position = patch.remember_position;
    }
    if patch.width.is_some() {
      self.width = patch.width;
    }
    if patch.height.is_some() {
      self.height = patch.height;
    }
    if patch.position_x.is_some() {
      self.position_x = patch.position_x;
    }
    if patch.position_y.is_some() {
      self.position_y = patch.position_y;
    }
    if patch.set_window_size.is_some() {
      self.set_window_size = patch.set_window_size;
    }
    if patch.set_window_position.is_some() {
      self.set_window_position = patch.set_window_position;
    }
    if patch.server_config.is_some() {
      self.server_config = patch.server_config;
    }

    self.save_file()
  }
}
