using System;
using System.Text;
using System.Threading;
using System.Windows.Forms;
class BenchmarkForm : Form { protected override bool ShowWithoutActivation { get { return true; } } }
class BenchmarkFixture {
  [STAThread] static void Main(string[] args) {
    Console.OutputEncoding=new UTF8Encoding(false);
    BenchmarkForm form=new BenchmarkForm {Text=args[0],Width=420,Height=180};
    TextBox editor=new TextBox {AccessibleName="Benchmark editor",Text="initial",Left=15,Top=15,Width=300};
    form.Controls.Add(editor);
    form.Shown+=delegate {Console.WriteLine(form.Handle.ToInt64());Console.Out.Flush();};
    ThreadPool.QueueUserWorkItem(delegate {
      string line;
      while((line=Console.ReadLine())!=null) {
        if(line=="stop") break;
        string[] parts=line.Split(' '); int id;
        if(parts.Length!=2 || !Int32.TryParse(parts[0],out id)) continue;
        try {
          form.Invoke((Action)delegate {
            if(parts[1]=="reset") editor.Text="initial";
            if(parts[1]!="reset" && parts[1]!="read") return;
            Console.WriteLine("{\"id\":"+id+",\"valueBase64\":\""+Convert.ToBase64String(Encoding.UTF8.GetBytes(editor.Text))+"\"}");
            Console.Out.Flush();
          });
        } catch(InvalidOperationException) {break;}
      }
      try {form.BeginInvoke((Action)delegate {form.Close();});} catch(InvalidOperationException) {}
    });
    System.Windows.Forms.Timer timeout=new System.Windows.Forms.Timer {Interval=300000};timeout.Tick+=delegate {form.Close();};timeout.Start();
    Application.Run(form);
  }
}
