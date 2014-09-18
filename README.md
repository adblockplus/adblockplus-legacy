Adblock Plus for Firefox
========================

Building
---------

### Requirements

- [Python 2.x](https://www.python.org)
- [The Jinja2 module](http://jinja.pocoo.org/docs)

### Building the extension

Run the following in the project directory:

    ./build.py build

This will create a build with a name in the form _adblockplus-1.2.3.nnnn.xpi_.
This file will contain the source code currently in the repository and all
available locales.

### Installing the extension automatically

To simplify the process of testing your changes you can install
[Extension Auto-Installer](https://addons.mozilla.org/addon/autoinstaller).
Assuming that Extension Auto-Installer is configured to use port 8888
(the default value), you can push your changes to the browser by running:

    ./build.py autoinstall 8888

The extension will be updated immediately.

Running the unit tests
----------------------

To verify your changes you can use the existing
[unit test suite](https://hg.adblockplus.org/adblockplustests). The unit tests
are a separate extension that is installed in addition to Adblock Plus. You can
either install the
[existing unit test builds](https://adblockplus.org/devbuilds/adblockplustests)
or clone the repository and create your own build. After installing the unit
tests go to _chrome://adblockplustests/content/index.html_ to run the tests.
