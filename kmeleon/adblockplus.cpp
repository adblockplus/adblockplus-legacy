/* ***** BEGIN LICENSE BLOCK *****
 * Version: MPL 1.1
 *
 * The contents of this file are subject to the Mozilla Public License Version
 * 1.1 (the "License"); you may not use this file except in compliance with
 * the License. You may obtain a copy of the License at
 * http://www.mozilla.org/MPL/
 *
 * Software distributed under the License is distributed on an "AS IS" basis,
 * WITHOUT WARRANTY OF ANY KIND, either express or implied. See the License
 * for the specific language governing rights and limitations under the
 * License.
 *
 * The Original Code is Adblock Plus.
 *
 * The Initial Developer of the Original Code is
 * Wladimir Palant.
 * Portions created by the Initial Developer are Copyright (C) 2006-2007
 * the Initial Developer. All Rights Reserved.
 *
 * Contributor(s):
 *
 * ***** END LICENSE BLOCK ***** */

#include <windows.h>
#include "adblockplus.h"

abpWrapper* wrapper = new abpWrapper();
char labelValues[NUM_LABELS][100];

JSFunctionSpec component_methods[] = {
  {"getMostRecentWindow", FakeGetMostRecentWindow, 1, 0, 0},
  {"openWindow", JSOpenDialog, 3, 0, 0},
  {NULL},
};

JSFunctionSpec browser_methods[] = {
  {"openDialog", JSOpenDialog, 3, 0, 0},
  {"setIcon", JSSetIcon, 1, 0, 0},
  {"hideStatusBar", JSHideStatusBar, 1, 0, 0},
  {"addEventListener", FakeAddEventListener, 3, 0, 0},
  {"removeEventListener", FakeRemoveEventListener, 3, 0, 0},
  {"delayedOpenTab", FakeOpenTab, 1, 0, 0},
  {"showItem", FakeShowItem, 2, 0, 0},
  {"createCommandID", JSCreateCommandID, 0, 0, 0},
  {"createPopupMenu", JSCreatePopupMenu, 0, 0, 0},
  {"addMenuItem", JSAddMenuItem, 7, 0, 0},
  {NULL},
};
JSPropertySpec browser_properties[] = {
  {"contentWindow", 0, JSPROP_READONLY|JSPROP_PERMANENT, JSGetContentWindow, nsnull},
  {"content", 1, JSPROP_READONLY|JSPROP_PERMANENT, JSGetContentWindow, nsnull},
  {"wrapper", 2, JSPROP_READONLY|JSPROP_PERMANENT, JSGetWrapper, nsnull},
  {NULL},
};

kmeleonFunctions* abpWrapper::kFuncs = NULL;
WORD abpWrapper::cmdBase = 0;
void* abpWrapper::origWndProc = NULL;
HWND abpWrapper::hMostRecent = NULL;
HWND abpWrapper::hSidebarDlg = NULL;
HWND abpWrapper::hSettingsDlg = NULL;
nsCOMPtr<nsIDOMWindowInternal> abpWrapper::fakeBrowserWindow;
nsIDOMWindow* abpWrapper::currentWindow = nsnull;
nsCOMPtr<nsIWindowWatcher> abpWrapper::watcher;
nsCOMPtr<nsIIOService> abpWrapper::ioService;
nsCOMPtr<nsIRDFService> abpWrapper::rdfService;
nsCOMPtr<nsIRDFDataSource> abpWrapper::localStore;
nsCOMPtr<nsIPrincipal> abpWrapper::systemPrincipal;
abpWindowList abpWrapper::activeWindows;
abpListenerList abpWrapper::selectListeners;
abpToolbarDataList abpWrapper::toolbarList;
abpStatusBarList abpWrapper::statusbarList;
int abpWrapper::setNextLeft = 0;
int abpWrapper::setNextTop = 0;
int abpWrapper::setNextWidth = 0;
int abpWrapper::setNextHeight = 0;
HHOOK abpWrapper::hook = NULL;

BOOL APIENTRY DllMain(HINSTANCE hinstDLL, DWORD fdwReason, LPVOID lpvReserved) {
  return TRUE;
}

/************************
 * JavaScript callbacks *
 ************************/

JS_STATIC_DLL_CALLBACK(void) Reporter(JSContext *cx, const char *message, JSErrorReport *rep) {
  nsresult rv;

  nsCOMPtr<nsIConsoleService> consoleService = do_GetService(NS_CONSOLESERVICE_CONTRACTID);
  nsCOMPtr<nsIScriptError> errorObject = do_CreateInstance(NS_SCRIPTERROR_CONTRACTID);
  if (consoleService == nsnull || errorObject == nsnull)
    return;

  nsString messageUni(NS_ConvertASCIItoUTF16(message+0));
  nsString fileUni(NS_ConvertASCIItoUTF16(rep->filename));
  PRUint32 column = rep->uctokenptr - rep->uclinebuf;

  rv = errorObject->Init(messageUni.get(),
                         fileUni.get(),
                         NS_REINTERPRET_CAST(const PRUnichar*, rep->uclinebuf),
                         rep->lineno, column, rep->flags, "XPConnect JavaScript");
  if (NS_FAILED(rv))
    return;

  rv = consoleService->LogMessage(errorObject);
  if (NS_FAILED(rv))
    return;
}

JSBool JS_DLL_CALLBACK JSFocusDialog(JSContext* cx, JSObject* obj, uintN argc, jsval* argv, jsval* rval) {
  nsresult rv;
  *rval = JSVAL_VOID;

  nsCOMPtr<nsIXPConnect> xpc = do_GetService(nsIXPConnect::GetCID());
  if (xpc == nsnull)
    return JS_TRUE;

  nsCOMPtr<nsIXPConnectWrappedNative> wrapped;
  rv = xpc->GetWrappedNativeOfJSObject(cx, obj, getter_AddRefs(wrapped));
  if (NS_FAILED(rv))
    return JS_TRUE;

  nsCOMPtr<nsISupports> native;
  rv = wrapped->GetNative(getter_AddRefs(native));
  if (NS_FAILED(rv))
    return JS_TRUE;

  nsCOMPtr<nsIDOMWindow> wnd = do_QueryInterface(native);
  if (wnd == nsnull)
    return JS_TRUE;

  wrapper->Focus(wnd);
  return JS_TRUE;
}

JSBool JS_DLL_CALLBACK FakeGetMostRecentWindow(JSContext* cx, JSObject* obj, uintN argc, jsval* argv, jsval* rval) {
  *rval = JSVAL_NULL;

  char* type;
  if (!JS_ConvertArguments(cx, argc, argv, "s", &type))
    return JS_FALSE;

  nsIDOMWindowInternal* wnd = nsnull;
  if (strcmp(type, "navigator:browser") == 0)
    wnd = wrapper->GetBrowserWindow();
  else if (strcmp(type, "abp:settings") == 0)
    wnd = wrapper->GetSettingsWindow();

  if (wnd != nsnull) {
    PRBool closed;
    nsresult rv = wnd->GetClosed(&closed);
    if (NS_SUCCEEDED(rv) && closed)
      wnd = nsnull;
  }

  if (wnd == nsnull)
    return JS_TRUE;

  JSObject* ret = wrapper->GetGlobalObject(wnd);
  if (ret == nsnull)
    ret = wrapper->UnwrapNative(wnd);
  if (ret == nsnull)
    return JS_TRUE;

  // Fix up focus function
  JS_DefineFunction(cx, ret, "focus", JSFocusDialog, 0, 0);

  *rval = OBJECT_TO_JSVAL(ret);
  return JS_TRUE;
}

JSBool JS_DLL_CALLBACK JSOpenDialog(JSContext* cx, JSObject* obj, uintN argc, jsval* argv, jsval* rval) {
  *rval = JSVAL_NULL;

  JSBool dummy;
  char* url;
  char* target = nsnull;
  char* features = nsnull;
  nsCOMPtr<nsISupportsArray> args;
  if (argc == 5) {
    // nsIWindowWatcher.openWindow
    if (!JS_ConvertArguments(cx, argc, argv, "bsssb", &dummy, &url, &target, &features, &dummy))
      return JS_FALSE;
  }
  else {
    // window.openDialog
    if (!JS_ConvertArguments(cx, argc, argv, "s/ss", &url, &target, &features))
      return JS_FALSE;

    // Convert dialog arguments
    if (argc > 3) {
      nsCOMPtr<nsIXPConnect> xpc = do_GetService(nsIXPConnect::GetCID());
      args = do_CreateInstance("@mozilla.org/supports-array;1");
      for (uintN i = 3; xpc && args && i < argc; i++) {
        nsCOMPtr<nsISupports> value;
        JS_SetProperty(cx, JSVAL_TO_OBJECT(argv[i]), "wrappedJSObject", &argv[i]);
        if (NS_SUCCEEDED(xpc->WrapJS(cx, JSVAL_TO_OBJECT(argv[i]), NS_GET_IID(nsISupports), getter_AddRefs(value))))
          args->AppendElement(value);
      }
    }
  }

  JSObject* ret = wrapper->OpenDialog(url, target, features, args);
  if (ret == nsnull)
    return JS_TRUE;

  *rval = OBJECT_TO_JSVAL(ret);
  return JS_TRUE;  
}

JSBool JS_DLL_CALLBACK JSSetIcon(JSContext* cx, JSObject* obj, uintN argc, jsval* argv, jsval* rval) {
  *rval = JSVAL_VOID;

  if (argc == 1)
    wrapper->SetCurrentIcon(JSVAL_TO_INT(argv[0]));

  return JS_TRUE;
}

JSBool JS_DLL_CALLBACK JSHideStatusBar(JSContext* cx, JSObject* obj, uintN argc, jsval* argv, jsval* rval) {
  *rval = JSVAL_VOID;

  if (argc == 1)
    wrapper->HideStatusBar(JSVAL_TO_BOOLEAN(argv[0]));

  return JS_TRUE;
}

JSBool JS_DLL_CALLBACK FakeAddEventListener(JSContext* cx, JSObject* obj, uintN argc, jsval* argv, jsval* rval) {
  *rval = JSVAL_VOID;
  if (argc != 3)
    return JS_TRUE;

  JSString* event = JS_ValueToString(cx, argv[0]);
  JSFunction* handler = JS_ValueToFunction(cx, argv[1]);
  if (event == nsnull || handler == nsnull || strcmp(JS_GetStringBytes(event), "select") != 0)
    return JS_TRUE;

  wrapper->AddSelectListener(cx, handler);
  return JS_TRUE;
}

JSBool JS_DLL_CALLBACK FakeRemoveEventListener(JSContext* cx, JSObject* obj, uintN argc, jsval* argv, jsval* rval) {
  *rval = JSVAL_VOID;
  if (argc != 3)
    return JS_TRUE;

  JSString* event = JS_ValueToString(cx, argv[0]);
  JSFunction* handler = JS_ValueToFunction(cx, argv[1]);
  if (event == nsnull || handler == nsnull || strcmp(JS_GetStringBytes(event), "select") != 0)
    return JS_TRUE;

  wrapper->RemoveSelectListener(handler);
  return JS_TRUE;
}

JSBool JS_DLL_CALLBACK FakeOpenTab(JSContext* cx, JSObject* obj, uintN argc, jsval* argv, jsval* rval) {
  *rval = JSVAL_VOID;
  if (argc != 1)
    return JS_TRUE;

  JSString* url = JS_ValueToString(cx, argv[0]);
  if (url == nsnull)
    return JS_TRUE;

  wrapper->OpenTab(JS_GetStringBytes(url));
  return JS_TRUE;
}

JSBool JS_DLL_CALLBACK FakeShowItem(JSContext* cx, JSObject* obj, uintN argc, jsval* argv, jsval* rval) {
  *rval = JSVAL_VOID;

  char* item;
  JSBool show;
  if (!JS_ConvertArguments(cx, argc, argv, "sb", &item, &show))
    return JS_FALSE;

  if (!show)
    return JS_TRUE;

  if (strcmp(item, "abp-image-menuitem") == 0)
    wrapper->AddContextMenuItem(CMD_IMAGE, labelValues[LABEL_CONTEXT_IMAGE]);
  else if (strcmp(item, "abp-object-menuitem") == 0)
    wrapper->AddContextMenuItem(CMD_OBJECT, labelValues[LABEL_CONTEXT_OBJECT]);
  else if (strcmp(item, "abp-link-menuitem") == 0)
    wrapper->AddContextMenuItem(CMD_LINK, labelValues[LABEL_CONTEXT_LINK]);
  else if (strcmp(item, "abp-frame-menuitem") == 0)
    wrapper->AddContextMenuItem(CMD_FRAME, labelValues[LABEL_CONTEXT_FRAME]);

  return JS_TRUE;
}

JSBool JS_DLL_CALLBACK JSCreateCommandID(JSContext* cx, JSObject* obj, uintN argc, jsval* argv, jsval* rval) {
  *rval = INT_TO_JSVAL(wrapper->CreateCommandID());

  return JS_TRUE;
}

JSBool JS_DLL_CALLBACK JSCreatePopupMenu(JSContext* cx, JSObject* obj, uintN argc, jsval* argv, jsval* rval) {
  HMENU ret = CreatePopupMenu();
  *rval = INT_TO_JSVAL(ret);

  return JS_TRUE;
}

JSBool JS_DLL_CALLBACK JSAddMenuItem(JSContext* cx, JSObject* obj, uintN argc, jsval* argv, jsval* rval) {
  *rval = JSVAL_VOID;

  int32 menu;
  int32 type;
  int32 menuID;
  char* label;
  JSBool default;
  JSBool disabled;
  JSBool checked;
  if (!JS_ConvertArguments(cx, argc, argv, "jjjsbbb", &menu, &type, &menuID, &label, &default, &disabled, &checked))
    return JS_FALSE;
  
  HMENU hMenu = (HMENU)menu;

  MENUITEMINFO info = {0};
  info.cbSize = sizeof info;
  info.fMask = MIIM_STATE | MIIM_SUBMENU | MIIM_TYPE;
  if (menuID >= 0 && !disabled)
    info.fMask |= MIIM_ID;
  info.fType = (type < 0 ? MFT_SEPARATOR : MFT_STRING);
  info.fState = (disabled ? MFS_GRAYED : MFS_ENABLED);
  if (checked)
    info.fState |= MFS_CHECKED;
  if (default)
    info.fState |= MFS_DEFAULT;
  info.wID = (UINT)menuID;
  info.hSubMenu = type > 0 ? (HMENU)type : NULL;
  info.dwTypeData = label;

  InsertMenuItem(hMenu, -1, TRUE, &info);

  return JS_TRUE;
}

JSBool JS_DLL_CALLBACK JSGetContentWindow(JSContext *cx, JSObject *obj, jsval id, jsval *vp) {
  abpJSContextHolder holder;
  JSObject* overlay = wrapper->UnwrapNative(wrapper->GetBrowserWindow());
  if (!holder.get() || !overlay)
    return PR_FALSE;

  jsval args[1];
  JSObject* wndObj = wrapper->GetGlobalObject(wrapper->GetCurrentWindow());
  if (wndObj != nsnull)
    args[0] = OBJECT_TO_JSVAL(wndObj);
  else
    args[0] = OBJECT_TO_JSVAL(obj);

  // HACKHACK: There is probably a better way to wrap the object
  return JS_CallFunctionName(holder.get(), overlay, "wrapNode", 1, args, vp);
}

JSBool JS_DLL_CALLBACK JSGetWrapper(JSContext *cx, JSObject *obj, jsval id, jsval *vp) {
  nsresult rv;

  nsCOMPtr<nsIXPConnect> xpc = do_GetService(nsIXPConnect::GetCID());
  if (xpc == nsnull)
    return JS_FALSE;

  nsCOMPtr<nsIXPConnectJSObjectHolder> wrapperHolder;
  rv = xpc->WrapNative(cx, JS_GetParent(cx, obj), NS_STATIC_CAST(nsIClassInfo*, wrapper), NS_GET_IID(nsIClassInfo), getter_AddRefs(wrapperHolder));
  if (NS_FAILED(rv))
    return JS_FALSE;

  JSObject* result;
  rv = wrapperHolder->GetJSObject(&result);
  if (NS_FAILED(rv))
    return JS_FALSE;

  *vp = OBJECT_TO_JSVAL(result);
  return JS_TRUE;
}

/**********************
 * K-Meleon callbacks *
 **********************/

LONG abpWrapper::DoMessage(LPCSTR to, LPCSTR from, LPCSTR subject, LONG data1, LONG data2)
{
  if (to[0] != '*' && _stricmp(to, kPlugin.dllname) != 0)
    return 0;

  LONG ret = 1;
  if (_stricmp(subject, "Load") == 0) {
    ret = (Load() ? 1 : -1);
    if (ret == -1 && watcher)
      watcher->UnregisterNotification(wrapper);
  }
  else if (_stricmp(subject, "Setup") == 0)
    Setup();
  else if (_stricmp(subject, "Create") == 0)
    Create((HWND)data1);
  else if (_stricmp(subject, "Close") == 0)
    Close((HWND)data1);
  else if (_stricmp(subject, "Config") == 0)
    Config((HWND)data1);
  else if (_stricmp(subject, "Quit") == 0)
    Quit();
  else if (_stricmp(subject, "DoMenu") == 0) {
    LPSTR action = (LPSTR)data2;
    if (*action == 0)
      ret = 0;
    else {
      LPSTR string = strchr(action, ',');
      if (string) {
        *string = 0;
        string++;
      }
      else
        string = action;
  
      DoMenu((HMENU)data1, action, string);
    }
  }
  else if (_stricmp(subject, "DoAccel") == 0)
    *(PINT)data2 = DoAccel((LPSTR)data1);
  else if (_stricmp(subject, "DoRebar") == 0)
    DoRebar((HWND)data1);
  else
    ret = 0;

  return ret;
}

PRBool abpWrapper::Load() {
  nsresult rv;

  kFuncs = kPlugin.kFuncs;

  abpJSContextHolder contextHolder;
  JSContext* cx = contextHolder.get();
  if (cx == nsnull)
    return PR_FALSE;

#ifndef TOOLKIT_ONLY
  nsCOMPtr<nsIChromeRegistrySea> registry = do_GetService("@mozilla.org/chrome/chrome-registry;1");
  if (registry) {
    // If we got the SeaMonkey registry this is probably K-Meleon 1.0, skip registration for K-Meleon 1.1

    rv = registry->InstallPackage("jar:resource:/chrome/adblockplus.jar!/content/", PR_FALSE);
    if (NS_FAILED(rv)) {
      JS_ReportError(cx, "Adblock Plus: Failed to register Adblock Plus chrome content");
      return PR_FALSE;
    }

    rv = registry->InstallLocale("jar:resource:/chrome/adblockplus.jar!/locale/" ABP_LANGUAGE "/", PR_FALSE);
    if (NS_FAILED(rv)) {
      JS_ReportError(cx, "Adblock Plus: Failed to register Adblock Plus locale");
      return PR_FALSE;
    }

    rv = registry->InstallSkin("jar:resource:/chrome/adblockplus.jar!/skin/classic/", PR_FALSE, PR_TRUE);
    if (NS_FAILED(rv)) {
      JS_ReportError(cx, "Adblock Plus: Failed to register Adblock Plus skin");
      return PR_FALSE;
    }

    rv = registry->SelectLocaleForPackage(NS_LITERAL_CSTRING(ABP_LANGUAGE), NS_LL("adblockplus"), PR_FALSE);
    if (NS_FAILED(rv)) {
      JS_ReportError(cx, "Adblock Plus: Failed to select Adblock Plus locale");
      return PR_FALSE;
    }

    rv = registry->SelectSkinForPackage(NS_LITERAL_CSTRING("classic/1.0"), NS_LL("adblockplus"), PR_FALSE);
    if (NS_FAILED(rv)) {
      JS_ReportError(cx, "Adblock Plus: Failed to select Adblock Plus skin");
      return PR_FALSE;
    }
  }
#endif

  watcher = do_GetService(NS_WINDOWWATCHER_CONTRACTID);
  if (watcher == nsnull) {
    JS_ReportError(cx, "Adblock Plus: Failed to retrieve window watcher - wrong Gecko version?");
    return PR_FALSE;
  }

  rv = watcher->RegisterNotification(wrapper);
  if (NS_FAILED(rv)) {
    JS_ReportError(cx, "Adblock Plus: Failed to register for window watcher notifications");
    return PR_FALSE;
  }

  ioService = do_GetService("@mozilla.org/network/io-service;1");
  if (ioService == nsnull) {
    JS_ReportError(cx, "Adblock Plus: Failed to retrieve IO service - wrong Gecko version?");
    return PR_FALSE;
  }

  // Do not error out if we cannot get localstore, can work without it
  rdfService = do_GetService("@mozilla.org/rdf/rdf-service;1");
  if (rdfService)
    rdfService->GetDataSourceBlocking("rdf:local-store", getter_AddRefs(localStore));

  if (!PatchComponent(cx))
    return PR_FALSE;

  cmdBase = kFuncs->GetCommandIDs(NUM_COMMANDS);
  toolbarList.init(cmdBase + CMD_TOOLBAR);
  statusbarList.init(wrapper->hImages, cmdBase + CMD_STATUSBAR, kFuncs->AddStatusBarIcon, kFuncs->RemoveStatusBarIcon);

  return PR_TRUE;
}

void abpWrapper::Setup() {
  hook = SetWindowsHookEx(WH_CALLWNDPROCRET, &HookProc, NULL, GetCurrentThreadId());

  nsCOMPtr<nsIPrefBranch> branch(do_GetService(NS_PREFSERVICE_CONTRACTID));
  if (branch != nsnull) {
    ReadAccelerator(branch, "extensions.adblockplus.settings_key", "adblockplus(Preferences)");
    ReadAccelerator(branch, "extensions.adblockplus.sidebar_key", "adblockplus(ListAll)");
    ReadAccelerator(branch, "extensions.adblockplus.enable_key", "adblockplus(ToggleEnabled)");
  }

  wrapper->LoadImage(0);
}

void abpWrapper::Quit() {
  if (hook)
    UnhookWindowsHookEx(hook);
}

void abpWrapper::Create(HWND parent) {
  static PRBool initialized = PR_FALSE;
  if (!initialized) {
    initialized = PR_TRUE;

    abpJSContextHolder holder;
    JSContext* cx = holder.get();
    JSObject* overlay = UnwrapNative(fakeBrowserWindow);
    jsval retval;
    if (cx != nsnull)
      if (overlay == nsnull || !JS_CallFunctionName(cx, overlay, "abpInit", 0, nsnull, &retval))
        JS_ReportError(cx, "Adblock Plus: Failed to initialize overlay.js");
  }

  statusbarList.addStatusBar(parent);

  if (IsWindowUnicode(parent)) {
    origWndProc = (WNDPROC)GetWindowLongW(parent, GWL_WNDPROC);
    SetWindowLongW(parent, GWL_WNDPROC, (LONG)&WndProc);
  }
  else {
    origWndProc = (WNDPROC)GetWindowLongA(parent, GWL_WNDPROC);
    SetWindowLongA(parent, GWL_WNDPROC, (LONG)&WndProc);
  }

  hMostRecent = parent;
}

void abpWrapper::Close(HWND parent) {
  toolbarList.removeWindow(parent);
  statusbarList.removeStatusBar(parent);
}

void abpWrapper::Config(HWND parent) {
  WndProc(parent, WM_COMMAND, cmdBase + CMD_PREFERENCES, 0);
}

void abpWrapper::DoMenu(HMENU menu, LPSTR action, LPSTR string) {
  UINT command = CommandByName(action);
  if (command >= 0)
    AppendMenuA(menu, MF_STRING, cmdBase + command, string);
}

INT abpWrapper::DoAccel(LPSTR action) {
  UINT command = CommandByName(action);
  if (command >= 0)
    return cmdBase + command;

  return 0;
}

void abpWrapper::DoRebar(HWND hRebar) {
  DWORD dwStyle = CCS_NODIVIDER | CCS_NOPARENTALIGN | CCS_NORESIZE |
    TBSTYLE_FLAT | TBSTYLE_TRANSPARENT | TBSTYLE_TOOLTIPS;

  HWND toolbar = kFuncs->CreateToolbar(GetParent(hRebar), dwStyle);
  if (!toolbar)
    return;

  TBBUTTON button = {0};
  button.iBitmap = 0;
  button.idCommand = cmdBase + CMD_TOOLBAR;
  button.fsState = TBSTATE_ENABLED;
  button.fsStyle = TBSTYLE_BUTTON;
  button.dwData = 0;
  button.iString = -1;

  SendMessage(toolbar, TB_BUTTONSTRUCTSIZE, (WPARAM)sizeof(button), 0);
  SendMessage(toolbar, TB_ADDBUTTONS, 1, (LPARAM)&button);

  int width, height;
  ImageList_GetIconSize(wrapper->hImages, &width, &height);
  SendMessage(toolbar, TB_SETBUTTONSIZE, 0, (LPARAM)MAKELONG(width, height));
  SendMessage(toolbar, TB_SETIMAGELIST, 0, (LPARAM)wrapper->hImages);

  DWORD dwBtnSize = SendMessage(toolbar, TB_GETBUTTONSIZE, 0, 0); 
  width = LOWORD(dwBtnSize);
  height = HIWORD(dwBtnSize);

  kFuncs->RegisterBand(toolbar, "Adblock Plus", TRUE);

  REBARBANDINFO rebar = {0};
  rebar.cbSize = sizeof(rebar);
  rebar.fMask  = RBBIM_ID | RBBIM_STYLE | RBBIM_CHILD | RBBIM_CHILDSIZE | RBBIM_SIZE | RBBIM_IDEALSIZE;
  rebar.wID = 'AB';
  rebar.fStyle = RBBS_CHILDEDGE | RBBS_FIXEDBMP;
  rebar.hwndChild  = toolbar;
  rebar.cxMinChild = width;
  rebar.cyMinChild = height;
  rebar.cyMaxChild = height;
  rebar.cxIdeal    = width;
  rebar.cx         = width;
  SendMessage(hRebar, RB_INSERTBAND, (WPARAM)-1, (LPARAM)&rebar);

  toolbarList.addToolbar(toolbar, hRebar);
}

LRESULT abpWrapper::WndProc(HWND hWnd, UINT message, WPARAM wParam, LPARAM lParam) {
  if (message == WM_COMMAND) {
    WORD command = LOWORD(wParam) - cmdBase;
    if (command == CMD_PREFERENCES) {
      abpJSContextHolder holder;
      JSObject* overlay = UnwrapNative(fakeBrowserWindow);
      jsval retval;
      if (holder.get() != nsnull && overlay != nsnull)
        JS_CallFunctionName(holder.get(), overlay, "abpSettings", 0, nsnull, &retval);
      return TRUE;
    }
    else if (command == CMD_LISTALL) {
      abpJSContextHolder holder;
      JSObject* overlay = UnwrapNative(fakeBrowserWindow);
      jsval retval;
      if (holder.get() != nsnull && overlay != nsnull)
        JS_CallFunctionName(holder.get(), overlay, "abpToggleSidebar", 0, nsnull, &retval);
      return TRUE;
    }
    else if (command == CMD_TOGGLEENABLED) {
      abpJSContextHolder holder;
      JSObject* overlay = UnwrapNative(fakeBrowserWindow);
      if (holder.get() != nsnull && overlay != nsnull) {
        char pref[] = "enabled";
        JSString* str = JS_NewStringCopyZ(holder.get(), pref);
        if (str != nsnull) {
          jsval retval;
          jsval args[] = {STRING_TO_JSVAL(str)};
          JS_CallFunctionName(holder.get(), overlay, "abpTogglePref", 1, args, &retval);
        }
      }
      return TRUE;
    }
    else if (command == CMD_IMAGE) {
      abpJSContextHolder holder;
      JSObject* overlay = UnwrapNative(fakeBrowserWindow);
      JSContext* cx = holder.get();
      if (cx != nsnull && overlay != nsnull) {
        jsval arg;
        jsval retval;
        if ((JS_GetProperty(cx, overlay, "abpBgData", &arg) && !JSVAL_IS_NULL(arg)) ||
            (JS_GetProperty(cx, overlay, "abpData", &arg) && !JSVAL_IS_NULL(arg)))
          JS_CallFunctionName(cx, overlay, "abpNode", 1, &arg, &retval);
      }
    }
    else if (command == CMD_OBJECT) {
      abpJSContextHolder holder;
      JSObject* overlay = UnwrapNative(fakeBrowserWindow);
      JSContext* cx = holder.get();
      if (cx != nsnull && overlay != nsnull) {
        jsval arg;
        jsval retval;
        if (JS_GetProperty(cx, overlay, "abpData", &arg) && !JSVAL_IS_NULL(arg))
          JS_CallFunctionName(cx, overlay, "abpNode", 1, &arg, &retval);
      }
    }
    else if (command == CMD_LINK) {
      abpJSContextHolder holder;
      JSObject* overlay = UnwrapNative(fakeBrowserWindow);
      JSContext* cx = holder.get();
      if (cx != nsnull && overlay != nsnull) {
        jsval arg;
        jsval retval;
        if (JS_GetProperty(cx, overlay, "abpLinkData", &arg) && !JSVAL_IS_NULL(arg))
          JS_CallFunctionName(cx, overlay, "abpNode", 1, &arg, &retval);
      }
    }
    else if (command == CMD_FRAME) {
      abpJSContextHolder holder;
      JSObject* overlay = UnwrapNative(fakeBrowserWindow);
      JSContext* cx = holder.get();
      if (cx != nsnull && overlay != nsnull) {
        jsval arg;
        jsval retval;
        if (JS_GetProperty(cx, overlay, "abpFrameData", &arg) && !JSVAL_IS_NULL(arg))
          JS_CallFunctionName(cx, overlay, "abpNode", 1, &arg, &retval);
      }
    }
    else if (command == CMD_TOOLBAR) {
      abpJSContextHolder holder;
      JSObject* overlay = UnwrapNative(fakeBrowserWindow);
      JSContext* cx = holder.get();
      if (cx != nsnull && overlay != nsnull) {
        jsval retval;
        // FIXME: Need to pass event parameter to allow opening context menu
        JS_CallFunctionName(cx, overlay, "abpCommandHandler", 0, nsnull, &retval);
      }
    }
    else if (command == CMD_STATUSBAR) {
      abpJSContextHolder holder;
      JSObject* overlay = UnwrapNative(fakeBrowserWindow);
      JSContext* cx = holder.get();
      JSObject* event = nsnull;
      if (cx != nsnull && overlay != nsnull) {
        event = JS_NewObject(cx, nsnull, nsnull, overlay);
        jsval button = JSVAL_ZERO;
        if (event != nsnull)
          JS_SetProperty(cx, event, "button", &button);
      }
      if (cx != nsnull && overlay != nsnull && event != nsnull) {
        jsval arg = OBJECT_TO_JSVAL(event);
        jsval retval;
        JS_CallFunctionName(cx, overlay, "abpClickHandler", 1, &arg, &retval);
      }
    }
    else {
      abpJSContextHolder holder;
      JSObject* overlay = UnwrapNative(fakeBrowserWindow);
      JSContext* cx = holder.get();
      if (cx != nsnull && overlay != nsnull) {
        jsval arg = INT_TO_JSVAL(LOWORD(wParam));
        jsval retval;
        JS_CallFunctionName(cx, overlay, "triggerMenuItem", 1, &arg, &retval);
      }
    }
  }
  else if (((message == TB_MBUTTONDOWN || message == TB_MBUTTONDBLCLK) && wParam == cmdBase + CMD_TOOLBAR) ||
           ((message == SB_MBUTTONDOWN || message == SB_MBUTTONDBLCLK) && wParam == cmdBase + CMD_STATUSBAR)) {
    abpJSContextHolder holder;
    char param[] = "enabled";
    JSObject* overlay = UnwrapNative(fakeBrowserWindow);
    JSContext* cx = holder.get();
    JSString* str = nsnull;
    if (cx)
      str = JS_NewString(cx, param, strlen(param));
    if (cx != nsnull && overlay != nsnull && str != nsnull) {
      jsval arg = STRING_TO_JSVAL(str);
      jsval retval;
      JS_CallFunctionName(cx, overlay, "abpTogglePref", 1, &arg, &retval);
    }
  }
  else if ((message == TB_RBUTTONDOWN && wParam == cmdBase + CMD_TOOLBAR) ||
           (message == SB_RBUTTONDOWN && wParam == cmdBase + CMD_STATUSBAR)) {
    abpJSContextHolder holder;
    JSObject* overlay = UnwrapNative(fakeBrowserWindow);
    JSContext* cx = holder.get();
    if (cx != nsnull && overlay != nsnull) {
      jsval arg = (message == TB_RBUTTONDOWN ? JSVAL_FALSE : JSVAL_TRUE);
      jsval retval;
      if (JS_CallFunctionName(cx, overlay, "buildContextMenu", 1, &arg, &retval)) {
        HMENU hMenu = NS_REINTERPRET_CAST(HMENU, JSVAL_TO_INT(retval));

        POINT pt;
        GetCursorPos(&pt);
        TrackPopupMenu(hMenu, TPM_LEFTALIGN, pt.x, pt.y, 0, hWnd, NULL);
      }
    }
  }
  else if (message == WM_SETFOCUS) {
    nsIDOMWindow* wnd = activeWindows.getWindow(hWnd);
    if (wnd && wnd != currentWindow) {
      currentWindow = wnd;
      selectListeners.notifyListeners();
    }
  }
  else if (message == WM_SIZE) {
    if (setNextWidth > 0 && setNextHeight > 0) {
      // Fix up window size
      SetWindowPos(hWnd, NULL, 0, 0, setNextWidth, setNextHeight, SWP_NOACTIVATE|SWP_NOMOVE|SWP_NOZORDER);
      setNextWidth = 0;
      setNextHeight = 0;
    }
    else
      SaveWindowPlacement(hWnd);
  }
  else if (message == WM_MOVE) {
    if (setNextLeft > 0 && setNextTop > 0) {
      // Fix up window position
      SetWindowPos(hWnd, NULL, setNextLeft, setNextTop, 0, 0, SWP_NOACTIVATE|SWP_NOSIZE|SWP_NOZORDER);
      setNextLeft = 0;
      setNextTop = 0;
    }
    else
      SaveWindowPlacement(hWnd);
  }

  if (IsWindowUnicode(hWnd))
    return CallWindowProcW((WNDPROC)origWndProc, hWnd, message, wParam, lParam);
  else
    return CallWindowProcA((WNDPROC)origWndProc, hWnd, message, wParam, lParam);
}

LRESULT CALLBACK abpWrapper::HookProc(int nCode, WPARAM wParam, LPARAM lParam) {
  if (nCode == HC_ACTION) {
    CWPRETSTRUCT* params = (CWPRETSTRUCT*)lParam;
    if (params->message == WM_DRAWITEM) {
      DRAWITEMSTRUCT* dis = (DRAWITEMSTRUCT*)params->lParam;
      WORD id = dis->itemID - cmdBase;
      if (dis->CtlType == ODT_MENU && id < NUM_COMMANDS)
        ImageList_Draw(wrapper->hImages, 0, dis->hDC, dis->rcItem.left + 1, dis->rcItem.top + 1, ILD_TRANSPARENT);
    }
  }

  return CallNextHookEx(hook, nCode, wParam, lParam);
}

/******************************
 * nsISupports implementation *
 ******************************/

NS_IMPL_ISUPPORTS5(abpWrapper, nsIDOMEventListener, nsIObserver, imgIDecoderObserver, nsIClassInfo, nsIXPCScriptable)

/**************************************
 * nsIDOMEventListener implementation *
 **************************************/

nsresult abpWrapper::HandleEvent(nsIDOMEvent* event) {
  nsresult rv;

  nsString type;
  rv = event->GetType(type);
  if (NS_FAILED(rv))
    return rv;

  if (type.Equals(NS_LITERAL_STRING("load"))) {
    nsCOMPtr<nsIDOMDocument> doc;
    rv = settingsDlg->GetDocument(getter_AddRefs(doc));
    if (NS_SUCCEEDED(rv)) {
      nsCOMPtr<nsIDOMElement> menuItem;
      rv = doc->GetElementById(NS_LITERAL_STRING("showintoolbar"), getter_AddRefs(menuItem));
      if (SUCCEEDED(rv))
        menuItem->SetAttribute(NS_LITERAL_STRING("hidden"), NS_LITERAL_STRING("true"));
    }
  }
  else if (type.Equals(NS_LITERAL_STRING("contextmenu"))) {
    abpJSContextHolder holder;
    JSObject* overlay = UnwrapNative(fakeBrowserWindow);
    JSContext* cx = holder.get();
    if (cx == nsnull || overlay == nsnull)
      return NS_ERROR_FAILURE;
  
    nsCOMPtr<nsIDOMEventTarget> target;
    rv = event->GetTarget(getter_AddRefs(target));
    if (NS_FAILED(rv) || target == nsnull)
      return NS_ERROR_FAILURE;
  
    nsCOMPtr<nsIXPConnect> xpc = do_GetService(nsIXPConnect::GetCID());
    if (xpc == nsnull)
      return NS_ERROR_FAILURE;
  
    nsCOMPtr<nsIXPConnectJSObjectHolder> wrapperHolder;
    rv = xpc->WrapNative(cx, JS_GetParent(cx, overlay), target, NS_GET_IID(nsIDOMEventTarget), getter_AddRefs(wrapperHolder));
    if (NS_FAILED(rv))
      return rv;
  
    JSObject* jsObj;
    rv = wrapperHolder->GetJSObject(&jsObj);
    if (NS_FAILED(rv))
      return rv;
  
    jsval value = OBJECT_TO_JSVAL(jsObj);
    if (!JS_SetProperty(cx, overlay, "target", &value))
      return NS_ERROR_FAILURE;
  
    ResetContextMenu();
    JS_CallFunctionName(cx, overlay, "abpCheckContext", 0, nsnull, &value);
  }

  return NS_OK;
}

/******************************
 * nsIObserver implementation *
 ******************************/

nsresult abpWrapper::Observe(nsISupports* subject, const char* topic, const PRUnichar* data) {
  nsCOMPtr<nsIDOMWindow> contentWnd = do_QueryInterface(subject);
  if (contentWnd == nsnull)
    return NS_ERROR_FAILURE;

  if (!IsBrowserWindow(contentWnd))
    return NS_OK;

  if (strcmp(topic, "domwindowopened") == 0) {
    HWND hWnd = GetHWND(contentWnd);
    activeWindows.addWindow(hWnd, contentWnd);

    nsCOMPtr<nsPIDOMWindow> privateWnd = do_QueryInterface(contentWnd);
    if (privateWnd == nsnull)
      return NS_ERROR_FAILURE;

    nsPIDOMWindow* rootWnd = privateWnd->GetPrivateRoot();
    if (rootWnd == nsnull)
      return NS_ERROR_FAILURE;

    nsIChromeEventHandler* chromeHandler = rootWnd->GetChromeEventHandler();
    if (chromeHandler == nsnull)
      return NS_ERROR_FAILURE;

    nsCOMPtr<nsIDOMEventTarget> target = do_QueryInterface(chromeHandler);
    if (target == nsnull)
      return NS_ERROR_FAILURE;

    target->AddEventListener(NS_LITERAL_STRING("contextmenu"), this, true);
  }
  else if (strcmp(topic, "domwindowclosed") == 0)
    activeWindows.removeWindow(contentWnd);

  return NS_OK;
}

/**************************************
 * imgIDecoderObserver implementation *
 **************************************/

nsresult abpWrapper::OnStopFrame(imgIRequest* aRequest, gfxIImageFrame *aFrame) {
  nsresult rv;

  gfx_format format;
  rv = aFrame->GetFormat(&format);
  if (NS_FAILED(rv))
    return rv;

  if (format != gfxIFormats::BGR_A8)
    return NS_ERROR_FAILURE;

  PRInt32 width;
  rv = aFrame->GetWidth(&width);
  if (NS_FAILED(rv))
    return rv;

  PRInt32 height;
  rv = aFrame->GetHeight(&height);
  if (NS_FAILED(rv))
    return rv;

  PRUint32 imageBytesPerRow;
  rv = aFrame->GetImageBytesPerRow(&imageBytesPerRow);
  if (NS_FAILED(rv))
    return rv;

  PRUint8* imageBits;
  PRUint32 imageSize;
  rv = aFrame->GetImageData(&imageBits, &imageSize);
  if (NS_FAILED(rv))
    return rv;

  PRUint32 alphaBytesPerRow;
  rv = aFrame->GetAlphaBytesPerRow(&alphaBytesPerRow);
  if (NS_FAILED(rv))
    return rv;

  PRUint8* alphaBits;
  PRUint32 alphaSize;
  rv = aFrame->GetAlphaData(&alphaBits, &alphaSize);
  if (NS_FAILED(rv))
    return rv;

  HDC hDC = ::GetDC(NULL);

  PRUint8* bits = new PRUint8[imageSize + alphaSize];

  for (PRUint32 i = 0, j = 0, n = 0; i < imageSize && j < alphaSize && n < imageSize + alphaSize;) {
    bits[n++] = imageBits[i++];
    bits[n++] = imageBits[i++];
    bits[n++] = imageBits[i++];
    bits[n++] = alphaBits[j++];
  }

  BITMAPINFOHEADER head;
  head.biSize = sizeof(head);
  head.biWidth = width;
  head.biHeight = height;
  head.biPlanes = 1;
  head.biBitCount = 32;
  head.biCompression = BI_RGB;
  head.biSizeImage = imageSize + alphaSize;
  head.biXPelsPerMeter = 0;
  head.biYPelsPerMeter = 0;
  head.biClrUsed = 0;
  head.biClrImportant = 0;

  HBITMAP image = ::CreateDIBitmap(hDC, NS_REINTERPRET_CAST(CONST BITMAPINFOHEADER*, &head),
                                   CBM_INIT, bits, NS_REINTERPRET_CAST(CONST BITMAPINFO*, &head),
                                   DIB_RGB_COLORS);
  delete bits;

  ImageList_Add(hImages, image, NULL);
  DeleteObject(image);

  ReleaseDC(NULL, hDC);

  return NS_OK;
}

nsresult abpWrapper::OnStartDecode(imgIRequest* aRequest) {
  return NS_OK;
}
nsresult abpWrapper::OnStartContainer(imgIRequest* aRequest, imgIContainer *aContainer) {
  return NS_OK;
}
nsresult abpWrapper::OnStartFrame(imgIRequest* aRequest, gfxIImageFrame *aFrame) {
  return NS_OK;
}
nsresult abpWrapper::OnDataAvailable(imgIRequest *aRequest, gfxIImageFrame *aFrame, const nsIntRect * aRect) {
  return NS_OK;
}
nsresult abpWrapper::OnStopContainer(imgIRequest* aRequest, imgIContainer *aContainer) {
  return NS_OK;
}
nsresult abpWrapper::OnStopDecode(imgIRequest* aRequest, nsresult status, const PRUnichar *statusArg) {
  LoadImage(currentImage + 1);
  return NS_OK;
}
nsresult abpWrapper::FrameChanged(imgIContainer *aContainer, gfxIImageFrame *aFrame, nsIntRect * aDirtyRect) {
  return NS_OK;
}

/*******************************
 * nsIClassInfo implementation *
 *******************************/

NS_METHOD abpWrapper::GetContractID(char** retval) {
  NS_ENSURE_ARG_POINTER(retval);

  // Need to set this, otherwise K-Meleon will crash (???)
  *retval = "";

  return NS_ERROR_NOT_AVAILABLE;
}

NS_METHOD abpWrapper::GetClassDescription(char** retval) {
  return NS_ERROR_NOT_AVAILABLE;
}

NS_METHOD abpWrapper::GetClassID(nsCID** retval) {
  return NS_ERROR_NOT_AVAILABLE;
}

NS_METHOD abpWrapper::GetImplementationLanguage(PRUint32* retval) {
  NS_ENSURE_ARG_POINTER(retval);

  *retval = nsIProgrammingLanguage::JAVASCRIPT;

  return NS_OK;
}

NS_METHOD abpWrapper::GetFlags(PRUint32* retval) {
  NS_ENSURE_ARG_POINTER(retval);

  *retval = nsIClassInfo::MAIN_THREAD_ONLY | nsIClassInfo::DOM_OBJECT;

  return NS_OK;
}

NS_METHOD abpWrapper::GetClassIDNoAlloc(nsCID* retval) {
  return NS_ERROR_NOT_AVAILABLE;
}

NS_METHOD abpWrapper::GetHelperForLanguage(PRUint32 language, nsISupports** retval) {
  NS_ENSURE_ARG_POINTER(retval);

  *retval = NS_STATIC_CAST(nsIClassInfo*, this);
  NS_ADDREF(this);

  return NS_OK;
}

NS_METHOD abpWrapper::GetInterfaces(PRUint32* count, nsIID*** array) {
  NS_ENSURE_ARG_POINTER(count);
  NS_ENSURE_ARG_POINTER(array);

  *count = 0;
  *array = nsnull;

  return NS_OK;
}

/***********************************
 * nsIXPCScriptable implementation *
 ***********************************/

NS_METHOD abpWrapper::GetClassName(char** retval) {
  NS_ENSURE_ARG_POINTER(retval);

  *retval = "abpWrapper";

  return NS_OK;
}

NS_METHOD abpWrapper::GetScriptableFlags(PRUint32* retval) {
  NS_ENSURE_ARG_POINTER(retval);

  *retval = nsIXPCScriptable::WANT_GETPROPERTY | nsIXPCScriptable::WANT_NEWRESOLVE;

  return NS_OK;
}

NS_METHOD abpWrapper::GetProperty(nsIXPConnectWrappedNative* wrapper, JSContext* cx, JSObject* obj, jsval id, jsval* vp, PRBool* _retval) {
  nsresult rv = NS_OK;

  JSString* property = JS_ValueToString(cx, id);
  if (property == nsnull)
    return NS_ERROR_FAILURE;

  nsCOMPtr<nsISupports> native;
  rv = wrapper->GetNative(getter_AddRefs(native));
  if (NS_FAILED(rv))
    return rv;

  JSObject* innerObj = UnwrapNative(native);
  if (innerObj == nsnull)
    return NS_ERROR_FAILURE;

  if (!JS_GetUCProperty(cx, innerObj, JS_GetStringChars(property), JS_GetStringLength(property), vp))
    return NS_ERROR_FAILURE;

  return rv;
}

NS_METHOD abpWrapper::NewResolve(nsIXPConnectWrappedNative* wrapper, JSContext* cx, JSObject* obj, jsval id, PRUint32 flags, JSObject** objp, PRBool* _retval) {
  nsresult rv = NS_OK;
  *_retval = PR_FALSE;

  nsCOMPtr<nsISupports> native;
  rv = wrapper->GetNative(getter_AddRefs(native));
  if (NS_FAILED(rv))
    return rv;

  JSObject* innerObj = UnwrapNative(native);
  if (innerObj == nsnull)
    return NS_ERROR_FAILURE;

  *objp = innerObj;
  *_retval = PR_TRUE;

  return NS_OK;
}

NS_METHOD abpWrapper::PreCreate(nsISupports* nativeObj, JSContext* cx, JSObject* globalObj, JSObject** parentObj) {
  return NS_ERROR_NOT_IMPLEMENTED;
}
NS_METHOD abpWrapper::Create(nsIXPConnectWrappedNative* wrapper, JSContext* cx, JSObject* obj) {
  return NS_ERROR_NOT_IMPLEMENTED;
}
NS_METHOD abpWrapper::PostCreate(nsIXPConnectWrappedNative* wrapper, JSContext* cx, JSObject* obj) {
  return NS_ERROR_NOT_IMPLEMENTED;
}
NS_METHOD abpWrapper::AddProperty(nsIXPConnectWrappedNative* wrapper, JSContext* cx, JSObject* obj, jsval id, jsval* vp, PRBool* _retval) {
  return NS_ERROR_NOT_IMPLEMENTED;
}
NS_METHOD abpWrapper::DelProperty(nsIXPConnectWrappedNative* wrapper, JSContext* cx, JSObject* obj, jsval id, jsval* vp, PRBool* _retval) {
  return NS_ERROR_NOT_IMPLEMENTED;
}
NS_METHOD abpWrapper::SetProperty(nsIXPConnectWrappedNative* wrapper, JSContext* cx, JSObject* obj, jsval id, jsval* vp, PRBool* _retval) {
  return NS_ERROR_NOT_IMPLEMENTED;
}
NS_METHOD abpWrapper::Enumerate(nsIXPConnectWrappedNative* wrapper, JSContext* cx, JSObject* obj, PRBool* _retval) {
  return NS_ERROR_NOT_IMPLEMENTED;
}
NS_METHOD abpWrapper::NewEnumerate(nsIXPConnectWrappedNative* wrapper, JSContext* cx, JSObject* obj, PRUint32 enum_op, jsval* statep, jsid* idp, PRBool* _retval) {
  return NS_ERROR_NOT_IMPLEMENTED;
}
NS_METHOD abpWrapper::Convert(nsIXPConnectWrappedNative* wrapper, JSContext* cx, JSObject* obj, PRUint32 type, jsval* vp, PRBool* _retval) {
  return NS_ERROR_NOT_IMPLEMENTED;
}
NS_METHOD abpWrapper::Finalize(nsIXPConnectWrappedNative* wrapper, JSContext* cx, JSObject* obj) {
  return NS_ERROR_NOT_IMPLEMENTED;
}
NS_METHOD abpWrapper::CheckAccess(nsIXPConnectWrappedNative* wrapper, JSContext* cx, JSObject* obj, jsval id, PRUint32 mode, jsval* vp, PRBool* _retval) {
  return NS_ERROR_NOT_IMPLEMENTED;
}
NS_METHOD abpWrapper::Call(nsIXPConnectWrappedNative* wrapper, JSContext* cx, JSObject* obj, PRUint32 argc, jsval* argv, jsval* vp, PRBool* _retval) {
  return NS_ERROR_NOT_IMPLEMENTED;
}
NS_METHOD abpWrapper::Construct(nsIXPConnectWrappedNative* wrapper, JSContext* cx, JSObject* obj, PRUint32 argc, jsval* argv, jsval* vp, PRBool* _retval) {
  return NS_ERROR_NOT_IMPLEMENTED;
}
NS_METHOD abpWrapper::HasInstance(nsIXPConnectWrappedNative* wrapper, JSContext* cx, JSObject* obj, jsval val, PRBool* bp, PRBool* _retval) {
  return NS_ERROR_NOT_IMPLEMENTED;
}
NS_METHOD abpWrapper::Mark(nsIXPConnectWrappedNative* wrapper, JSContext* cx, JSObject* obj, void* arg, PRUint32* _retval) {
  return NS_ERROR_NOT_IMPLEMENTED;
}
NS_METHOD abpWrapper::Equality(nsIXPConnectWrappedNative* wrapper, JSContext* cx, JSObject* obj, jsval val, PRBool* _retval) {
  return NS_ERROR_NOT_IMPLEMENTED;
}
NS_METHOD abpWrapper::OuterObject(nsIXPConnectWrappedNative* wrapper, JSContext* cx, JSObject* obj, JSObject** _retval) {
  return NS_ERROR_NOT_IMPLEMENTED;
}
NS_METHOD abpWrapper::InnerObject(nsIXPConnectWrappedNative* wrapper, JSContext* cx, JSObject* obj, JSObject** _retval) {
  return NS_ERROR_NOT_IMPLEMENTED;
}

/**************************
 * JS object manupulation *
 **************************/

PRBool abpWrapper::PatchComponent(JSContext* cx) {
  nsresult rv;

  nsCOMPtr<nsIScriptSecurityManager> secman = do_GetService(NS_SCRIPTSECURITYMANAGER_CONTRACTID);
  if (secman == nsnull) {
    JS_ReportError(cx, "Adblock Plus: Failed to retrieve security manager - wrong Gecko version?");
    return PR_FALSE;
  }

  rv = secman->GetSystemPrincipal(getter_AddRefs(systemPrincipal));
  if (NS_FAILED(rv) || systemPrincipal == nsnull) {
    JS_ReportError(cx, "Adblock Plus: Failed to retrieve system's security principal");
    return PR_FALSE;
  }

  nsCOMPtr<nsISupports> abp = do_CreateInstance(ADBLOCKPLUS_CONTRACTID);
  if (abp == nsnull) {
    // Maybe the component isn't registered yet? Try registering it.
    nsCOMPtr<nsIComponentRegistrar> compReg;
    rv = NS_GetComponentRegistrar(getter_AddRefs(compReg));
    if (NS_FAILED(rv) || compReg == nsnull) {
      JS_ReportError(cx, "Adblock Plus: Failed to retrieve component registrar - wrong Gecko version?");
      return PR_FALSE;
    }

    nsCOMPtr<nsIProperties> dirService = do_GetService("@mozilla.org/file/directory_service;1");
    if (dirService == nsnull) {
      JS_ReportError(cx, "Adblock Plus: Failed to retrieve directory service - wrong Gecko version?");
      return PR_FALSE;
    }

    nsCOMPtr<nsILocalFile> compFile;
    rv = dirService->Get(NS_XPCOM_COMPONENT_DIR, NS_GET_IID(nsILocalFile), getter_AddRefs(compFile));
    if (NS_FAILED(rv)) {
      JS_ReportError(cx, "Adblock Plus: Failed to retrieve components directory");
      return PR_FALSE;
    }

    compFile->AppendRelativePath(NS_LITERAL_STRING("nsAdblockPlus.js"));
    rv = compReg->AutoRegister(compFile);
    if (NS_FAILED(rv)) {
      JS_ReportError(cx, "Adblock Plus: Failed to register nsAdblockPlus.js");
      return PR_FALSE;
    }

    abp = do_CreateInstance(ADBLOCKPLUS_CONTRACTID);
  }
  if (abp == nsnull) {
    JS_ReportError(cx, "Adblock Plus: Failed to retrieve Adblock Plus component");
    return PR_FALSE;
  }

  JSObject* jsObject = UnwrapNative(abp);
  if (jsObject == nsnull) {
    JS_ReportError(cx, "Adblock Plus: Failed extracting JavaScript object from Adblock Plus component");
    return PR_FALSE;
  }

  if (!JS_DefineFunctions(cx, jsObject, component_methods)) {
    JS_ReportError(cx, "Adblock Plus: Failed to patch up Adblock Plus component methods");
    return PR_FALSE;
  }

  JSBool found;
  JS_SetPropertyAttributes(cx, JS_GetParent(cx, jsObject), "windowMediator", JSPROP_ENUMERATE | JSPROP_PERMANENT, &found);
  JS_SetPropertyAttributes(cx, JS_GetParent(cx, jsObject), "windowWatcher", JSPROP_ENUMERATE | JSPROP_PERMANENT, &found);

  jsval value = OBJECT_TO_JSVAL(jsObject);
  if (!JS_SetProperty(cx, JS_GetParent(cx, jsObject), "windowMediator", &value)) {
    JS_ReportError(cx, "Adblock Plus: Failed to replace window mediator in Adblock Plus component");
    return PR_FALSE;
  }

  value = OBJECT_TO_JSVAL(jsObject);
  if (!JS_SetProperty(cx, JS_GetParent(cx, jsObject), "windowWatcher", &value)) {
    JS_ReportError(cx, "Adblock Plus: Failed to replace window watcher in Adblock Plus component");
    return PR_FALSE;
  }

  if (!CreateFakeBrowserWindow(cx, JS_GetParent(cx, jsObject)))
    return PR_FALSE;

  return PR_TRUE;
}

PRBool abpWrapper::CreateFakeBrowserWindow(JSContext* cx, JSObject* parent) {
  nsresult rv;
  jsval value;

  JSObject* obj = JS_NewObject(cx, nsnull, nsnull, parent);
  if (obj == nsnull) {
    JS_ReportError(cx, "Adblock Plus: Failed to create fake browser window object - out of memory?");
    return PR_FALSE;
  }
  JS_SetGlobalObject(cx, obj);

  if (!JS_DefineFunctions(cx, obj, browser_methods)) {
    JS_ReportError(cx, "Adblock Plus: Failed to attach native methods to fake browser window");
    return PR_FALSE;
  }

  if (!JS_DefineProperties(cx, obj, browser_properties)) {
    JS_ReportError(cx, "Adblock Plus: Failed to attach native properties to fake browser window");
    return PR_FALSE;
  }

  JSPrincipals* principals;
  rv = systemPrincipal->GetJSPrincipals(cx, &principals);
  if (NS_FAILED(rv)) {
    JS_ReportError(cx, "Adblock Plus: Could not convert system principal into JavaScript principals");
    return PR_FALSE;
  }

  char inlineScriptBody[] = ABP_INLINE_SCRIPT;
  JSScript* inlineScript = JS_CompileScriptForPrincipals(cx, obj, principals, inlineScriptBody, strlen(inlineScriptBody), "adblockplus.dll inline script", 1);
  JSPRINCIPALS_DROP(cx, principals);
  if (inlineScript == nsnull) {
    JS_ReportError(cx, "Adblock Plus: Failed to compile inline JavaScript code");
    return PR_FALSE;
  }

  if (!JS_ExecuteScript(cx, obj, inlineScript, &value)) {
    JS_ReportError(cx, "Adblock Plus: Failed to execute inline JavaScript code");
    return PR_FALSE;
  }
  JS_DestroyScript(cx, inlineScript);

  nsCOMPtr<nsIXPConnect> xpc = do_GetService(nsIXPConnect::GetCID());
  if (xpc == nsnull) {
    JS_ReportError(cx, "Adblock Plus: Coult not retrieve nsIXPConnect - wrong Gecko version?");
    return PR_FALSE;
  }

  nsCOMPtr<nsISupports> wrapped;
  rv = xpc->WrapJS(cx, obj, NS_GET_IID(nsISupports), getter_AddRefs(wrapped));
  if (NS_FAILED(rv)) {
    JS_ReportError(cx, "Adblock Plus: Failed to create XPConnect wrapper for fake browser window");
    return PR_FALSE;
  }

  fakeBrowserWindow = do_QueryInterface(wrapped);
  if (fakeBrowserWindow == nsnull) {
    JS_ReportError(cx, "Adblock Plus: Failed to QI fake browser window");
    return PR_FALSE;
  }

  for (int i = 0; i < NUM_LABELS; i++) {
    JSString* str = JS_NewStringCopyZ(cx, labels[i]);
    if (str == nsnull) {
      JS_ReportError(cx, "Adblock Plus: Could not create JavaScript string for '%s' - out of memory?", labels[i]);
      return PR_FALSE;
    }
  
    jsval args[] = {STRING_TO_JSVAL(str)};
    jsval retval;
    if (!JS_CallFunctionName(cx, obj, "getOverlayEntity", 1, args, &retval)) {
      JS_ReportError(cx, "Adblock Plus: Failed to retrieve entity '%s' from overlay.dtd", labels[i]);
      return PR_FALSE;
    }

    str = JS_ValueToString(cx, retval);
    if (str == nsnull) {
      JS_ReportError(cx, "Adblock Plus: Could not convert return value of getOverlayEntity() to string");
      return PR_FALSE;
    }

    strcpy_s(labelValues[i], sizeof(labelValues[i]), JS_GetStringBytes(str));
  }

  return PR_TRUE;
}

JSObject* abpWrapper::UnwrapNative(nsISupports* native) {
  nsCOMPtr<nsIXPConnectWrappedJS> holder = do_QueryInterface(native);
  if (holder == nsnull)
    return nsnull;

  JSObject* innerObj;
  nsresult rv = holder->GetJSObject(&innerObj);
  if (NS_FAILED(rv))
    return nsnull;

  return innerObj;
}


/********************
 * Helper functions *
 ********************/

PRBool abpWrapper::IsBrowserWindow(nsIDOMWindow* contentWnd) {
  nsresult rv;

  nsCOMPtr<nsIClassInfo> classInfo = do_QueryInterface(contentWnd);
  if (classInfo == nsnull)
    return PR_FALSE;

  char* descr;
  rv = classInfo->GetClassDescription(&descr);
  if (NS_FAILED(rv))
    return PR_FALSE;

  return (strcmp(descr, "Window") == 0 ? PR_TRUE : PR_FALSE);
}

HWND abpWrapper::GetHWND(nsIDOMWindow* wnd) {
  nsresult rv;

  nsCOMPtr<nsIWebBrowserChrome> chrome;
  rv = watcher->GetChromeForWindow(wnd, getter_AddRefs(chrome));
  if (NS_FAILED(rv) || chrome == nsnull)
    return NULL;

  nsCOMPtr<nsIEmbeddingSiteWindow> site = do_QueryInterface(chrome);
  if (site == nsnull)
    return NULL;

  HWND ret;
  rv = site->GetSiteWindow((void**)&ret);
  if (NS_FAILED(rv))
    return NULL;

  return ret;
}

INT abpWrapper::CommandByName(LPSTR action) {
  INT command = -1;
  if (_stricmp(action, "Preferences") == 0)
    command = CMD_PREFERENCES;
  else if (_stricmp(action, "ListAll") == 0)
    command = CMD_LISTALL;
  else if (_stricmp(action, "ToggleEnabled") == 0)
    command = CMD_TOGGLEENABLED;

  return command;
}

void abpWrapper::ReadAccelerator(nsIPrefBranch* branch, const char* pref, const char* command) {
  PRBool control = PR_FALSE;
  PRBool alt = PR_FALSE;
  PRBool shift = PR_FALSE;
  PRBool virt = PR_FALSE;
  char* key = nsnull;
  char buf[256] = "";

  char* part;
  char* next;
  nsresult rv = branch->GetCharPref(pref, &part);
  if (NS_FAILED(rv))
    return;

  for (char* c = part; *c; c++)
    if (*c >= 'a' && *c <= 'z')
      *c -= 'a' - 'A';

  while (part) {
    next = strchr(part, ' ');
    if (next)
      *next++ = 0;

    if (((part[0] >= 'A' && part[0] <= 'Z') || (part[0] >= '0' && part[0] <= '9')) && part[1] == 0) {
      key = part;
      virt = PR_FALSE;
    }
    else if (strcmp(part, "ACCEL") == 0 || strcmp(part, "CONTROL") == 0 || strcmp(part, "CTRL") == 0)
      control = PR_TRUE;
    else if (strcmp(part, "ALT") == 0)
      alt = PR_TRUE;
    else if (strcmp(part, "SHIFT") == 0)
      shift = PR_TRUE;
    else {
      int num = 0;
      int valid = 0;
      for (char* c = part; *c; c++,num++)
        if ((*c >= 'A' && *c <= 'Z') || (*c >= '0' && *c <= '9') || *c == '_')
          valid++;

      if (num > 1 && valid == num) {
        key = part;
        virt = PR_TRUE;
      }
    }
    part = next;
  }

  if (key != nsnull) {
    if (control)
      strcat_s(buf, sizeof buf, "CTRL ");
    if (alt)
      strcat_s(buf, sizeof buf, "ALT ");
    if (shift)
      strcat_s(buf, sizeof buf, "SHIFT ");
    if (virt)
      strcat_s(buf, sizeof buf, "VK_");
  
    strcat_s(buf, sizeof buf, key);

    strcat_s(buf, sizeof buf, " = ");
    strcat_s(buf, sizeof buf, command);
  
    kFuncs->ParseAccel(buf);
  }
}

JSObject* abpWrapper::OpenDialog(char* url, char* target, char* features, nsISupportsArray* args) {
  nsresult rv;
  nsCOMPtr<nsIDOMWindow> wnd;

  rv = watcher->OpenWindow(fakeBrowserWindow, url, target, features, args, getter_AddRefs(wnd));
  if (NS_FAILED(rv) || wnd == nsnull)
    return nsnull;

  if (strstr(url, "sidebarDetached.xul")) {
    hSidebarDlg = hMostRecent;

    SetWindowPos(hMostRecent, HWND_TOPMOST, 0, 0, 0, 0, SWP_NOACTIVATE | SWP_NOOWNERZORDER | SWP_NOMOVE | SWP_NOSIZE);

    // Set default sidebar dialog height
    setNextWidth = 600;
    setNextHeight = 400;
  }
  else if (strstr(url, "settings.xul")) {
    hSettingsDlg = hMostRecent;

    settingsDlg = do_QueryInterface(wnd);

    nsCOMPtr<nsIDOMEventTarget> target = do_QueryInterface(settingsDlg);
    if (target != nsnull)
      target->AddEventListener(NS_LITERAL_STRING("load"), this, PR_FALSE);
  }

  // Restore previous width/height settings for the dialog
  nsCOMPtr<nsIRDFResource> persist = GetPersistResource(hMostRecent);
  if (persist) {
    GetLocalStoreInt(persist, "left", &setNextLeft);
    GetLocalStoreInt(persist, "top", &setNextTop);
    GetLocalStoreInt(persist, "width", &setNextWidth);
    GetLocalStoreInt(persist, "height", &setNextHeight);
  }

  return wrapper->GetGlobalObject(wnd);
}

JSObject* abpWrapper::GetGlobalObject(nsIDOMWindow* wnd) {
  nsCOMPtr<nsIScriptGlobalObject> global = do_QueryInterface(wnd);
  if (global == nsnull)
    return nsnull;

  return global->GetGlobalJSObject();
}

nsresult abpWrapper::OpenTab(const char* url) {
  nsresult rv = NS_OK;
  
  kFuncs->SendMessage("layers", PLUGIN_NAME, "AddLayersToWindow", (LONG)"1", (LONG)url);

  return rv;
}

nsresult abpWrapper::AddSelectListener(JSContext* cx, JSFunction* func) {
  selectListeners.addListener(cx, func);

  return NS_OK;
}

nsresult abpWrapper::RemoveSelectListener(JSFunction* func) {
  selectListeners.removeListener(func);

  return NS_OK;
}

void abpWrapper::Focus(nsIDOMWindow* wnd) {
  HWND hWnd = GetHWND(wnd);
  if (hWnd)
    BringWindowToTop(hWnd);
}

TCHAR* menus[] = {_T("DocumentPopup"), _T("DocumentImagePopup"), _T("TextPopup"),
                  _T("LinkPopup"), _T("ImageLinkPopup"), _T("ImagePopup"),
                  _T("FrameDocumentPopup"), _T("FrameDocumentImagePopup"), _T("FrameTextPopup"),
                  _T("FrameLinkPopup"), _T("FrameImageLinkPopup"), _T("FrameImagePopup"),
                  NULL};

void abpWrapper::AddContextMenuItem(WORD command, char* label) {
  MENUITEMINFO info = {0};
  info.cbSize = sizeof info;
  info.fMask = MIIM_TYPE;

  UINT drawFlag;
  for (int i = 0; menus[i]; i++) {
    HMENU hMenu = kFuncs->GetMenu(menus[i]);
    if (hMenu) {
      drawFlag = MF_OWNERDRAW;

      int count = GetMenuItemCount(hMenu);
      if (count > 0) {
        WORD id = GetMenuItemID(hMenu, count - 1) - cmdBase;
        if (id >= NUM_COMMANDS)
          AppendMenuA(hMenu, MF_SEPARATOR, cmdBase + CMD_SEPARATOR, NULL);

        // Only use MF_OWNERDRAW flag if other menu items have it as well
        if (GetMenuItemInfo(hMenu, 0, TRUE, &info) && !(info.fType & MFT_OWNERDRAW))
          drawFlag = MF_STRING;
      }
      AppendMenuA(hMenu, drawFlag, cmdBase + command, label);
    }
  }
}

void abpWrapper::ResetContextMenu() {
  for (int i = 0; menus[i]; i++) {
    HMENU hMenu = kFuncs->GetMenu(menus[i]);
    if (hMenu) {
      int count = GetMenuItemCount(hMenu);
      for (int j = 0; j < count; j++) {
        WORD id = GetMenuItemID(hMenu, j) - cmdBase;
        if (id < NUM_COMMANDS)
          RemoveMenu(hMenu, j--, MF_BYPOSITION);
      }
    }
  }
}

void abpWrapper::LoadImage(int index) {
  nsresult rv;

  currentImage = index;
  if (currentImage >= sizeof(images)/sizeof(images[0])) {
    toolbarList.invalidateToolbars();
    statusbarList.invalidateStatusBars();
    return;
  }

  nsCOMPtr<imgILoader> loader = do_GetService("@mozilla.org/image/loader;1");
  if (loader == nsnull)
    return;

  nsCOMPtr<nsIURI> uri;
  nsCString urlStr(images[index]);
  rv = ioService->NewURI(urlStr, nsnull, nsnull, getter_AddRefs(uri));
  if (NS_FAILED(rv))
    return;

  nsCOMPtr<imgIRequest> retval;
  rv = loader->LoadImage(uri, nsnull, nsnull, nsnull, this, nsnull,
                         nsIRequest::LOAD_NORMAL, nsnull, nsnull, getter_AddRefs(imageRequest));
  if (NS_FAILED(rv))
    return;

  return;
}

void abpWrapper::SaveWindowPlacement(HWND hWnd) {
  nsCOMPtr<nsIRDFResource> persist = GetPersistResource(hWnd);
  if (persist) {
    WINDOWPLACEMENT placement;
    if (GetWindowPlacement(hWnd, &placement)) {
      SetLocalStoreInt(persist, "left", placement.rcNormalPosition.left);
      SetLocalStoreInt(persist, "top", placement.rcNormalPosition.top);
      SetLocalStoreInt(persist, "width", placement.rcNormalPosition.right - placement.rcNormalPosition.left);
      SetLocalStoreInt(persist, "height", placement.rcNormalPosition.bottom - placement.rcNormalPosition.top);
    }
  }
}

already_AddRefed<nsIRDFResource> abpWrapper::GetPersistResource(HWND hWnd) {
  if (!localStore)
    return nsnull;

  nsCString name;
  if (hWnd == hSidebarDlg)
    name = "chrome://adblockplus/content/sidebarDetached.xul#abpDetachedSidebar";
  else if (hWnd == hSettingsDlg)
    name = "chrome://adblockplus/content/settings.xul#abpPreferencesWindow";

  if (!name.Length())
    return nsnull;

  nsIRDFResource* result;
  nsresult rv = rdfService->GetResource(name, &result);
  if (NS_FAILED(rv))
    return nsnull;

  return result;
}

void abpWrapper::GetLocalStoreInt(nsIRDFResource* source, char* property, int* value) {
  nsCString name(property);
  nsresult rv;

  nsCOMPtr<nsIRDFResource> link;
  rv = rdfService->GetResource(name, getter_AddRefs(link));
  if (NS_FAILED(rv))
    return;

  nsCOMPtr<nsIRDFNode> target;
  rv = localStore->GetTarget(source, link, PR_TRUE, getter_AddRefs(target));
  if (NS_FAILED(rv))
    return;

  nsCOMPtr<nsIRDFInt> intTarget = do_QueryInterface(target);
  if (!intTarget)
    return;

  PRInt32 result;
  rv = intTarget->GetValue(&result);
  if (NS_FAILED(rv))
    return;

  *value = result;
}

void abpWrapper::SetLocalStoreInt(nsIRDFResource* source, char* property, int value) {
  nsCString name(property);

  nsCOMPtr<nsIRDFResource> link;
  nsCOMPtr<nsIRDFNode> oldTarget;
  nsCOMPtr<nsIRDFInt> newTarget;

  rdfService->GetResource(name, getter_AddRefs(link));

  if (link)
    localStore->GetTarget(source, link, PR_TRUE, getter_AddRefs(oldTarget));
  if (oldTarget)
    localStore->Unassert(source, link, oldTarget);

  rdfService->GetIntLiteral(value, getter_AddRefs(newTarget));
  if (link && newTarget)
    localStore->Assert(source, link, newTarget, PR_TRUE);
}
