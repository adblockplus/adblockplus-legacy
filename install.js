// constants
const APP_DISPLAY_NAME = "Adblock Plus";
const APP_NAME = "adblockplus";
const APP_PACKAGE = "/adblockplus.mozdev.org";
const APP_VERSION = "{{VERSION}}";
const WARNING = "WARNING: You need administrator privileges to install Adblock Plus. It will be installed in the application directory for all users. Installing Adblock Plus in your profile is currently not supported in SeaMonkey. Proceed with the installation?";
const VERSION_ERROR = "This extension can only be installed in a browser based on Gecko 1.8 or higher, please upgrade your browser. Compatible browsers include Firefox 1.5, SeaMonkey 1.0 and Flock 0.5.";
const NOT_WRITABLE_ERROR = "This extension requires write access to the application directory to install properly. Currently write access to some of the relevant subdirectories is forbidden, you probably have to log in as root before installing. After installation no elevated privileges will be necessary, read access is sufficient to use Adblock Plus."
const locales = [
  "{{LOCALE}}",
  null
];

// Gecko 1.7 doesn't support custom button labels
var incompatible = (typeof Install.BUTTON_POS_0 == "undefined");
if (incompatible)
  alert(VERSION_ERROR);

if (!incompatible) {
  // Check whether all directories can be accessed
  var jarFolder = getFolder("Chrome");
  var dirList = [
    jarFolder,
    getFolder("Components"),
    getFolder(getFolder("Program", "defaults"), "pref")
  ];
  for (var i = 0; i < dirList.length; i++)
    if (!File.isWritable(dirList[i]))
      incompatible = true;

  if (incompatible)
    alert(NOT_WRITABLE_ERROR);
}

if (!incompatible && confirm(WARNING, APP_DISPLAY_NAME)) {
  var chromeType = DELAYED_CHROME;

  var files = [
    ["chrome/adblockplus.jar", jarFolder],
    ["components/nsAdblockPlus.js", getFolder("Components")],
    ["components/nsAdblockPlus.xpt", getFolder("Components")],
    ["defaults/preferences/adblockplus.js", getFolder(getFolder("Program", "defaults"), "pref")],
  ];
  
  // initialize our install
  initInstall(APP_NAME, APP_PACKAGE, APP_VERSION);
  
  // Add files
  for (var i = 0; i < files.length; i++)
    addFile(APP_NAME, APP_VERSION, files[i][0], files[i][1], null);

  var jar = getFolder(jarFolder, "adblockplus.jar");
  try {
    var err = registerChrome(CONTENT | chromeType, jar, "content/");
    if (err != SUCCESS)
      throw "Chrome registration for content failed (error code " + err + ").";

    err = registerChrome(SKIN | chromeType, jar, "skin/classic/");
    if (err != SUCCESS)
      throw "Chrome registration for skin failed (error code " + err + ").";

    for (i = 0; i < locales.length; i++) {
      if (!locales[i])
        continue;

      err = registerChrome(LOCALE | chromeType, jar, "locale/" + locales[i] + "/");
      if (err != SUCCESS)
        throw "Chrome registration for " + locales[i] + " locale failed (error code " + err + ").";
    }

    var err = performInstall();
    if (err != SUCCESS && err != 999)
      throw "Committing installation failed (error code " + err + ").";

    alert("Adblock Plus " + APP_VERSION + " is now installed.\n" +
          "It will become active after you restart your browser.");
  }
  catch (ex) {
    alert("Installation failed: " + ex + "\n" +
          "You probably don't have the necessary permissions (log in as system administrator).");
    cancelInstall(err);
  } 
}
