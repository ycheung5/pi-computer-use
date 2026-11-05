using System;
using System.Threading;
using System.IO;
using System.Windows.Forms;
class ManagedFixture : Form {
  [System.Runtime.InteropServices.DllImport("user32.dll")]static extern IntPtr GetForegroundWindow();
  [System.Runtime.InteropServices.DllImport("user32.dll")]static extern bool IsWindowVisible(IntPtr window);
  [System.Runtime.InteropServices.DllImport("user32.dll")]static extern bool IsIconic(IntPtr window);
  protected override bool ShowWithoutActivation {get{return true;}}
  [STAThread]static void Main(string[] args){
    if(args.Length>2&&args[1].StartsWith("workspace",StringComparison.Ordinal))File.AppendAllText(args[2],"started:"+System.Diagnostics.Process.GetCurrentProcess().Id+"\n");
    bool veto=args.Length>1&&args[1]=="veto-once",blocked=args.Length>1&&args[1]=="unresponsive",extended=args.Length>3&&args[3]=="extended";int closes=0;
    ManagedFixture form=new ManagedFixture{Text=args[0],StartPosition=FormStartPosition.Manual,Left=140,Top=160,Width=400,Height=220,ShowInTaskbar=false};
    if(args.Length>1&&args[1].StartsWith("workspace",StringComparison.Ordinal)) {
      form.Width=650;form.Height=400;
      bool documentTask=args[1]=="workspace-document";
      var taskEditors=new System.Collections.Generic.List<TextBox>();
      TabControl tabs=new TabControl{Left=10,Top=55,Width=600,Height=280};
      TabPage original=new TabPage("Original document");
      TextBox originalEditor=new TextBox{AccessibleName="Original editor",Multiline=false,Dock=DockStyle.Fill,Text=args.Length>3?File.ReadAllText(args[3]):"original work"};
      original.Controls.Add(originalEditor);tabs.TabPages.Add(original);form.Controls.Add(tabs);
      Button add=new Button{Text="New task tab",AccessibleName="New task tab",Left=10,Top=10,Width=130};if(args[1]!="workspace-unsafe")form.Controls.Add(add);
      add.Click+=delegate {
        TabPage task=new TabPage("Task "+tabs.TabPages.Count);var taskEditor=new TextBox{AccessibleName="Task editor",Multiline=false,Dock=DockStyle.Fill};task.Controls.Add(taskEditor);taskEditors.Add(taskEditor);
        tabs.TabPages.Add(task);tabs.SelectedTab=task;
        File.AppendAllText(args[2],"new-tab:"+tabs.TabPages.Count+":"+(GetForegroundWindow()==form.Handle)+":"+originalEditor.Text+"\n");
      };
      if(documentTask){
        Button save=new Button{Text="Save task",AccessibleName="Save task",Left=150,Top=10,Width=130};
        save.Click+=delegate {
          int index=tabs.SelectedIndex-1;
          if(index<0 || index>=taskEditors.Count)return;
          string value=taskEditors[index].Text;
          File.WriteAllText(args[2]+".task.txt",value,new System.Text.UTF8Encoding(false));
          File.AppendAllText(args[2],"saved:"+Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes(value))+"\n");
        };form.Controls.Add(save);
      }
      ManagedFixture caller=new ManagedFixture{Text=args[0]+" caller",Left=800,Top=160,Width=300,Height=200,ShowInTaskbar=false};
      System.Windows.Forms.Timer commands=new System.Windows.Forms.Timer{Interval=30};
      commands.Tick+=delegate {if(documentTask && File.Exists(args[2]+".observe")){
        File.Delete(args[2]+".observe");
        string taskValue=taskEditors.Count==1?taskEditors[0].Text:"";
        File.WriteAllText(args[2]+".state.pending",tabs.TabPages.Count+":"+tabs.SelectedIndex+":"+Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes(originalEditor.Text))+":"+taskEditors.Count+":"+Convert.ToBase64String(System.Text.Encoding.UTF8.GetBytes(taskValue))+":"+(IsWindowVisible(form.Handle) && !IsIconic(form.Handle)?1:0)+":"+(GetForegroundWindow()==form.Handle?1:0));
        File.Move(args[2]+".state.pending",args[2]+".state");
      }if(File.Exists(args[2]+".caller")){File.Delete(args[2]+".caller");caller.Show();caller.Activate();File.AppendAllText(args[2],"caller-front:"+(GetForegroundWindow()==caller.Handle)+"\n");}};
      commands.Start();form.FormClosed+=delegate{commands.Stop();commands.Dispose();caller.Close();};
    }
    form.FormClosing+=delegate(object sender,FormClosingEventArgs e){bool refused=veto&&closes++==0;if(args.Length>2)File.AppendAllText(args[2],refused?"veto\n":"close\n");if(refused)e.Cancel=true;};
    form.Shown+=delegate{if(blocked)Thread.Sleep(5000);};
    System.Windows.Forms.Timer expiry=new System.Windows.Forms.Timer{Interval=args.Length>2?120000:45000};
    if(!extended){expiry.Tick+=delegate{veto=false;form.Close();};if(Array.IndexOf(args,"--no-expiry")<0)expiry.Start();Application.Run(form);return;}
    TextBox focusProbe=new TextBox{AccessibleName="Pi foreground focus probe",Left=10,Top=10,Width=200};form.Controls.Add(focusProbe);
    focusProbe.GotFocus+=delegate{File.AppendAllText(args[2],"target-focused\n");};
    ApplicationContext context=new ApplicationContext();
    ManagedFixture distractor=new ManagedFixture{Text=args[0]+" distractor",StartPosition=FormStartPosition.Manual,Left=600,Top=160,Width=350,Height=200,ShowInTaskbar=false};
    ManagedFixture replacement=null;
    form.FormClosed+=delegate{
      replacement=new ManagedFixture{Text=args[0],StartPosition=FormStartPosition.Manual,Left=140,Top=160,Width=400,Height=220,ShowInTaskbar=false};
      replacement.FormClosing+=delegate{File.AppendAllText(args[2],"replacement-close\n");};
      replacement.FormClosed+=delegate{distractor.Close();context.ExitThread();};replacement.Show();
    };
    expiry.Tick+=delegate{veto=false;if(replacement==null)form.Close();else replacement.Close();};
    expiry.Start();distractor.Show();form.Show();Application.Run(context);
  }
}
