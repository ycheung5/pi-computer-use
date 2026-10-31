using System;
using System.Threading;
using System.Windows.Forms;
class BackgroundForm : Form { protected override bool ShowWithoutActivation { get { return true; } } }
class ControlsFixture {
  [System.Runtime.InteropServices.DllImport("user32.dll")] static extern bool SetForegroundWindow(IntPtr window);
  [System.Runtime.InteropServices.DllImport("user32.dll")] static extern IntPtr GetForegroundWindow();
  [System.Runtime.InteropServices.DllImport("user32.dll")] static extern IntPtr GetAncestor(IntPtr window,uint flags);
  [System.Runtime.InteropServices.DllImport("user32.dll")] static extern IntPtr GetWindow(IntPtr window,uint command);
  [System.Runtime.InteropServices.DllImport("user32.dll")] static extern bool IsWindowVisible(IntPtr window);
  [System.Runtime.InteropServices.StructLayout(System.Runtime.InteropServices.LayoutKind.Sequential)] struct Rect {public int Left,Top,Right,Bottom;}
  [System.Runtime.InteropServices.StructLayout(System.Runtime.InteropServices.LayoutKind.Sequential)] struct GuiInfo {public uint Size,Flags;public IntPtr Active,Focus,Capture,MenuOwner,MoveSize,Caret;public Rect CaretRect;}
  [System.Runtime.InteropServices.DllImport("user32.dll")] static extern bool GetGUIThreadInfo(uint thread,ref GuiInfo info);
  [System.Runtime.InteropServices.StructLayout(System.Runtime.InteropServices.LayoutKind.Sequential)] struct LASTINPUTINFO {public uint cbSize;public uint dwTime;}
  [System.Runtime.InteropServices.DllImport("user32.dll")] static extern bool GetLastInputInfo(ref LASTINPUTINFO value);
  [System.Runtime.InteropServices.DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr window,out uint pid);
  static uint InputTick(){LASTINPUTINFO value=new LASTINPUTINFO();value.cbSize=(uint)System.Runtime.InteropServices.Marshal.SizeOf(typeof(LASTINPUTINFO));GetLastInputInfo(ref value);return value.dwTime;}
  static uint ForegroundPid(){uint pid;GetWindowThreadProcessId(GetForegroundWindow(),out pid);return pid;}

  delegate bool EnumThreadWindow(IntPtr window,IntPtr data);
  [System.Runtime.InteropServices.DllImport("user32.dll")] static extern bool EnumThreadWindows(uint thread,EnumThreadWindow callback,IntPtr data);
  [System.Runtime.InteropServices.DllImport("user32.dll",CharSet=System.Runtime.InteropServices.CharSet.Unicode)] static extern int GetClassName(IntPtr window,System.Text.StringBuilder name,int maximum);
  [System.Runtime.InteropServices.DllImport("user32.dll")] static extern IntPtr CreatePopupMenu();
  [System.Runtime.InteropServices.DllImport("user32.dll",CharSet=System.Runtime.InteropServices.CharSet.Unicode)] static extern bool AppendMenu(IntPtr menu,uint flags,UIntPtr id,string label);
  [System.Runtime.InteropServices.DllImport("user32.dll")] static extern bool TrackPopupMenu(IntPtr menu,uint flags,int x,int y,int reserved,IntPtr owner,IntPtr rect);
  [System.Runtime.InteropServices.DllImport("user32.dll")] static extern bool DestroyMenu(IntPtr menu);
  [System.Runtime.InteropServices.DllImport("user32.dll")] static extern int GetMenuItemCount(IntPtr menu);
  [System.Runtime.InteropServices.DllImport("user32.dll")] static extern bool PostMessage(IntPtr window,uint message,IntPtr wParam,IntPtr lParam);
  static IntPtr NativeMenuWindow(uint thread) {IntPtr found=IntPtr.Zero;int count=0;EnumThreadWindows(thread,delegate(IntPtr h,IntPtr unused){var name=new System.Text.StringBuilder(64);GetClassName(h,name,name.Capacity);if(name.ToString()=="#32768" && IsWindowVisible(h)){count++;found=h;}return true;},IntPtr.Zero);return count==1?found:(count==0?IntPtr.Zero:new IntPtr(-1));}
  [System.Runtime.InteropServices.DllImport("user32.dll")] static extern short GetAsyncKeyState(int key);

  [STAThread] static void Main(string[] args) {
    Console.OutputEncoding=new System.Text.UTF8Encoding(false);
    BackgroundForm form=new BackgroundForm { Text=args[0],Width=520,Height=400 };
    TextBox edit=new TextBox { AccessibleName="Background editor",Text="original",Left=10,Top=10,Width=240 };
    TextBox readOnly=new TextBox { AccessibleName="Read only editor",Text="fixed",ReadOnly=true,Left=260,Top=10,Width=200 };
    Label status=new Label { AccessibleName="Clicked 0",Text="Clicked 0",Left=10,Top=45,Width=200 };
    Button button=new Button { AccessibleName="Background action",Text="Run",Left=10,Top=70,Width=100 };
    int doubles=0;bool hovered=false;button.MouseEnter+=delegate {hovered=true;};button.MouseLeave+=delegate {hovered=false;};
    int clicks=0;button.Click+=delegate { clicks++;status.Text=status.AccessibleName="Clicked "+clicks; };
    Label unsupported=new Label { AccessibleName="Unsupported label",Text="No action",Left=160,Top=70,Width=100 };
    Label scrollStatus=new Label { AccessibleName="Scrolled 0",Text="Scrolled 0",Left=10,Top=110,Width=200 };
    Panel panel=new Panel { AccessibleName="Background scroller",AutoScroll=true,Left=10,Top=140,Width=250,Height=160 };
    for(int index=0;index<30;index++)panel.Controls.Add(new Label {Text="Row "+index,Left=0,Top=index*25,Width=160});
    panel.Scroll+=delegate { scrollStatus.Text=scrollStatus.AccessibleName="Scrolled "+(-panel.AutoScrollPosition.Y); };
    Panel drag=new Panel {AccessibleName="Pointer fixture surface",Left=280,Top=140,Width=180,Height=150,BackColor=System.Drawing.Color.LightBlue};
    Label release=new Label {AccessibleName="Released 0",Text="Released 0",Left=280,Top=310,Width=180};
    int releases=0;drag.MouseDown+=delegate {release.Text=release.AccessibleName="Held";Console.WriteLine("pointer-down");Console.Out.Flush();};
    drag.MouseUp+=delegate {releases++;release.Text=release.AccessibleName="Released "+releases;};
    drag.MouseDoubleClick+=delegate {doubles++;};
    form.Controls.Add(drag);form.Controls.Add(release);
    TextBox disabled=new TextBox {AccessibleName="Disabled editor",Text="disabled fixed",Enabled=false,Left=280,Top=110,Width=180};form.Controls.Add(disabled);
    form.Controls.Add(edit);form.Controls.Add(readOnly);form.Controls.Add(status);form.Controls.Add(button);form.Controls.Add(unsupported);form.Controls.Add(scrollStatus);form.Controls.Add(panel);
    form.Shown+=delegate {Console.WriteLine(form.Handle.ToInt64());Console.Out.Flush();};
    BackgroundForm cover=null,popup=null,sibling=null;
    Form dialog=null;
    Button dialogButton=new Button {AccessibleName="Open owned test dialog",Text="Open test dialog",Left=280,Top=40,Width=180};
    dialogButton.Click+=delegate {if(dialog==null || dialog.IsDisposed){dialog=new Form {Text="Owned test dialog",StartPosition=FormStartPosition.Manual,Left=form.Right+10,Top=form.Top,Width=180,Height=140,ShowInTaskbar=false};dialog.Show(form);SetForegroundWindow(dialog.Handle);}};
    form.Controls.Add(dialogButton);
    ContextMenuStrip menu=null; IntPtr nativeMenuHandle=IntPtr.Zero; bool nativeMenu=Array.IndexOf(args,"--native-menu")>=0; ManualResetEventSlim nativeMenuSettled=new ManualResetEventSlim(false);
    Button menuButton=new Button {AccessibleName="Open owned test menu",Text="Open test menu",Left=280,Top=335,Width=180};
    menuButton.Click+=delegate {if(nativeMenu){nativeMenuSettled.Reset();nativeMenuHandle=CreatePopupMenu();if(nativeMenuHandle==IntPtr.Zero || !AppendMenu(nativeMenuHandle,0,new UIntPtr(1),"Owned menu item"))throw new InvalidOperationException("NATIVE_MENU_SETUP_FAILED");SetForegroundWindow(form.Handle);var pos=menuButton.PointToScreen(new System.Drawing.Point(0,menuButton.Height));try {TrackPopupMenu(nativeMenuHandle,0,pos.X,pos.Y,0,form.Handle,IntPtr.Zero);} finally {DestroyMenu(nativeMenuHandle);nativeMenuHandle=IntPtr.Zero;form.BeginInvoke((Action)delegate {nativeMenuSettled.Set();});}}else{if(menu==null || menu.IsDisposed){menu=new ContextMenuStrip();menu.Items.Add("Owned menu item");}SetForegroundWindow(form.Handle);menu.Show(form,new System.Drawing.Point(10,menuButton.Bottom));}};
    form.Controls.Add(menuButton);
    LinkLabel switchSibling=new LinkLabel {AccessibleName="Switch sibling",Text="Switch sibling",Left=280,Top=70,Width=180};
    switchSibling.LinkClicked+=delegate {if(sibling!=null){SetForegroundWindow(sibling.Handle);status.Text=status.AccessibleName=GetForegroundWindow()==sibling.Handle?"Sibling selected":"Sibling activation refused";}};form.Controls.Add(switchSibling);
    ThreadPool.QueueUserWorkItem(delegate {string command;while((command=Console.ReadLine())!=null){if(command=="stop"){if(nativeMenu)PostMessage(form.Handle,0x001F,IntPtr.Zero,IntPtr.Zero);break;}if(command=="dismiss-native-menu"){bool posted=PostMessage(form.Handle,0x001F,IntPtr.Zero,IntPtr.Zero);bool settled=posted && nativeMenuSettled.Wait(5000);uint ignored;uint thread=GetWindowThreadProcessId(form.Handle,out ignored);GuiInfo info=new GuiInfo{Size=(uint)System.Runtime.InteropServices.Marshal.SizeOf(typeof(GuiInfo))};bool known=GetGUIThreadInfo(thread,ref info);bool closed=known && (info.Flags & 0x1C)==0 && NativeMenuWindow(thread)==IntPtr.Zero;Console.WriteLine("native-menu-settlement:"+posted+":"+settled+":"+closed);Console.Out.Flush();}if(command=="observe-pointer")form.BeginInvoke((Action)delegate {Console.WriteLine("pointer-state:"+clicks+":"+doubles+":"+(hovered?1:0)+":"+(-panel.AutoScrollPosition.Y)+":"+((GetAsyncKeyState(1)&0x8000)!=0?1:0)+":"+releases+":"+GetForegroundWindow().ToInt64());Console.Out.Flush();});if(command=="prepare-focus")form.BeginInvoke((Action)delegate {form.ActiveControl=readOnly;Console.WriteLine("focus-ready");Console.Out.Flush();});if(command=="observe")form.BeginInvoke((Action)delegate {IntPtr fg=GetForegroundWindow();uint fgPid;GetWindowThreadProcessId(fg,out fgPid);Console.WriteLine("state:"+Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes(edit.Text))+":"+clicks+":"+(-panel.AutoScrollPosition.Y)+":"+edit.Focused+":"+Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes(readOnly.Text))+":"+Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes(disabled.Text))+":"+(form.ActiveControl==edit)+":"+fg.ToInt64()+":"+InputTick()+":"+form.Handle.ToInt64()+":"+fgPid+":"+GetAncestor(fg,2).ToInt64());Console.Out.Flush();});if(command=="menu-state")form.BeginInvoke((Action)delegate {uint ignored;uint thread=GetWindowThreadProcessId(form.Handle,out ignored);GuiInfo info=new GuiInfo{Size=(uint)System.Runtime.InteropServices.Marshal.SizeOf(typeof(GuiInfo))};bool known=GetGUIThreadInfo(thread,ref info);IntPtr h=nativeMenu?NativeMenuWindow(thread):(menu==null || menu.IsDisposed || !menu.IsHandleCreated?IntPtr.Zero:menu.Handle);uint pid=0;if(h!=IntPtr.Zero && h!=new IntPtr(-1))GetWindowThreadProcessId(h,out pid);long source=nativeMenu?(known && info.MenuOwner==form.Handle?form.Handle.ToInt64():0):(menu!=null && menu.SourceControl==form?form.Handle.ToInt64():0);int count=nativeMenu?(nativeMenuHandle==IntPtr.Zero?0:GetMenuItemCount(nativeMenuHandle)):(menu==null?0:menu.Items.Count);Console.WriteLine("menu-state:"+h.ToInt64()+":"+source+":"+pid+":"+(h!=IntPtr.Zero && h!=new IntPtr(-1) && IsWindowVisible(h))+":"+count+":"+(known?((info.Flags & 0x1C)!=0?"True":"False"):"Unknown"));Console.Out.Flush();});if(command=="dialog-state")form.BeginInvoke((Action)delegate {IntPtr h=dialog==null || dialog.IsDisposed?IntPtr.Zero:dialog.Handle;uint pid=0;if(h!=IntPtr.Zero)GetWindowThreadProcessId(h,out pid);Console.WriteLine("dialog-state:"+h.ToInt64()+":"+(h==IntPtr.Zero?0:GetWindow(h,4).ToInt64())+":"+pid+":"+(h!=IntPtr.Zero && IsWindowVisible(h)));Console.Out.Flush();});if(command=="popup")form.BeginInvoke((Action)delegate {
      popup=new BackgroundForm {Text="Owned popup",StartPosition=FormStartPosition.Manual,Left=form.Right+10,Top=form.Top,Width=180,Height=140,TopMost=true};
      if(popup.Right>Screen.FromControl(form).WorkingArea.Right){popup.Left=form.Left;popup.Top=form.Bottom+10;}
      Button item=new Button {Text="Popup action",AccessibleName="Popup action",Left=10,Top=10,Width=130};item.Click+=delegate {status.Text=status.AccessibleName="Popup clicked";form.Enabled=true;popup.Close();};popup.Controls.Add(item);popup.Show(form);form.Enabled=false;popup.Enabled=true;
      var point=item.PointToScreen(new System.Drawing.Point(item.Width/2,item.Height/2));Console.WriteLine("popup:"+point.X+":"+point.Y);Console.Out.Flush();
    });if(command=="foreground")form.BeginInvoke((Action)delegate {Console.WriteLine("foreground:"+GetForegroundWindow().ToInt64());Console.Out.Flush();});if(command=="sibling")form.BeginInvoke((Action)delegate {sibling=new BackgroundForm {Text="Existing sibling",Width=200,Height=120};sibling.Show();Console.WriteLine("sibling:"+sibling.Handle.ToInt64());Console.Out.Flush();});if(command=="shift")form.BeginInvoke((Action)delegate {form.Left+=20;form.Top+=15;Console.WriteLine("shifted");Console.Out.Flush();});if(command=="cover")form.BeginInvoke((Action)delegate {cover=new BackgroundForm {Text="Pointer guard cover",StartPosition=FormStartPosition.Manual,Bounds=form.Bounds,TopMost=true};cover.Show();Console.WriteLine("covered");Console.Out.Flush();});if(command=="remove")form.BeginInvoke((Action)delegate {form.Controls.Remove(button);button.Dispose();Console.WriteLine("removed");Console.Out.Flush();});}form.BeginInvoke((Action)delegate{if(cover!=null)cover.Close();if(popup!=null)popup.Close();if(sibling!=null)sibling.Close();if(dialog!=null && !dialog.IsDisposed)dialog.Close();if(menu!=null && !menu.IsDisposed){menu.Close();menu.Dispose();}form.Close();});});
    if(args.Length<2 || args[1]!="--no-expiry") {System.Windows.Forms.Timer timeout=new System.Windows.Forms.Timer {Interval=60000};timeout.Tick+=delegate{form.Close();};timeout.Start();}Application.Run(form);
  }
}
