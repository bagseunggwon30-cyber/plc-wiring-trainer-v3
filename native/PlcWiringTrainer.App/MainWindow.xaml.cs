using Microsoft.UI.Xaml;
using Windows.Graphics;

namespace PlcWiringTrainer.App;

public sealed partial class MainWindow : Window
{
    public MainWindow()
    {
        InitializeComponent();
        ExtendsContentIntoTitleBar = true;
        SetTitleBar(AppTitleBar);
        AppWindow.SetIcon("Assets/AppIcon.ico");
        AppWindow.Resize(new SizeInt32(1560, 940));
        RootFrame.Navigate(typeof(MainPage));
    }
}
