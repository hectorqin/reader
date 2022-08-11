///! Some config file template

/// template for reader core `config.yaml`
pub const READER_CONFIG_COMMENT: &str = "# The Config for Reader desktop App.
## web server port
# serverPort: 18080
## is debug mode
# debug: false
## window position X
# positionX: 100.0
## window position Y
# positionY: 20.0
## window width
# width: 1280.0
## window height
# height: 800.0
## whether to remember window size when window resized
# rememberSize: true
## whether to remember window postion when window moved
# rememberPosition: false
## whether to set window postion when start
# setWindowPosition: true
## whether to set window size when start
# setWindowSize: true
## reader server config
# serverConfig:
#   # is secure mode
#   reader.app.secure: false
#   # invite code required when new user registering
#   reader.app.inviteCode: \"\"
#   # secure key for user manage
#   reader.app.secureKey: \"\"
";

pub const READER_CONFIG: &[u8] = br#"
---
serverPort: 18080
debug: false
rememberSize: true
rememberPosition: false
width: 1280.0
height: 800.0
positionX: 0.0
positionY: 0.0
setWindowSize: true
setWindowPosition: false
serverConfig:
  reader.app.secure: false
  reader.app.inviteCode: ""
  reader.app.secureKey: ""
"#;

// /// template for `profiles.yaml`
// pub const PROFILES_CONFIG: &[u8] = b"# Profiles Config for Clash Verge

// current: ~
// items: ~
// ";
