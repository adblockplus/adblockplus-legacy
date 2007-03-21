#!/usr/bin/perl

use strict;

my $GECKO_DIR = 'c:\gecko_sdk';
my $GECKO2_DIR = 'c:\FFTree1\mozilla\dist';
my $CCFLAGS = '/O1 /W3 /LD /MT /DXP_WIN';
my $LDFLAGS = '/DLL /NODEFAULTLIB /NOLOGO /PDB:..\adblockplus.pdb';
my @INCLUDE_DIRS = ('c:\kmeleon_src', "$GECKO_DIR\\include");
my @LIB_DIRS = ("$GECKO_DIR\\lib");
my @LIBS = qw(libcmt.lib kernel32.lib user32.lib gdi32.lib comctl32.lib nspr4.lib plds4.lib plc4.lib xpcom.lib xpcomglue_s.lib embed_base_s.lib js3250.lib);

open(VERSION, "../version");
my $version = <VERSION>;
$version =~ s/[^\w\.]//gs;
close(VERSION);

my $output_file = shift @ARGV || "adblockplus.zip";
if ($ARGV[0] =~ /^\+/)
{
  $version .= $ARGV[0];
  shift @ARGV;
}

my @locales = @ARGV;
push @locales, "en-US" unless @locales;
my $charset = ($locales[0] eq "ru-RU" ? "windows-1251" : "iso-8859-1");
$CCFLAGS .= " /DTOOLKIT_ONLY" if $#locales > 0;

my $inline_script = "";
open(FILE, "adblockplus.js");
while(<FILE>) {
  s/\r//g;
  s/\\/\\\\/g;
  s/"/\\"/g;
  s/\n/\\n/g;
  s/\{\{CHARSET\}\}/$charset/g;
  $inline_script .= $_;
}
close(FILE);

# Remove license block
$inline_script =~ s/^\/\*.*?\*\/(?:\\n)+//;

rm_rec('tmp');
mkdir('tmp', 0755) or die "Failed to create directory tmp: $!";
system('') && exit;

cp('adblockplus.cpp', 'tmp/adblockplus.cpp', 1);
cp('adblockplus.h', 'tmp/adblockplus.h', 1);

chdir('tmp');
my $includes = join(' ', map {"/I$_"} @INCLUDE_DIRS);
my $libs = join(' ', map {"/LIBPATH:$_"} @LIB_DIRS);
system("cl $CCFLAGS $includes adblockplus.cpp @LIBS /link $LDFLAGS $libs") && exit;
system("mv adblockplus.dll ..") && exit;
chdir('..');

rm_rec('tmp');
mkdir('tmp', 0755) or die "Failed to create directory tmp: $!";
cp_rec("../$_", "tmp/$_") foreach ('chrome', 'components', 'defaults');
system("mv tmp/defaults/preferences tmp/defaults/pref") && exit;
cp("../chrome.manifest", "tmp/chrome/adblockplus.manifest", 1);
cp("adblockplus_extra.js", "tmp/defaults/pref/adblockplus_extra.js");
mkdir("tmp/kplugins", 0755) or die "Failed to created directory tmp/kplugins: $!";
system("mv adblockplus.dll tmp/kplugins/adblockplus.dll");
chdir('tmp');

chdir('chrome');
print `zip -rX0 adblockplus.jar content skin locale`;
rm_rec($_) foreach ('content', 'skin', 'locale');
chdir('..');

unlink('../$output_file');
print `zip -rX9 ../$output_file kplugins chrome components defaults`;

chdir('..');
rm_rec('tmp');

sub rm_rec
{
  my $dir = shift;

  opendir(local *DIR, $dir) or return;
  foreach my $file (readdir(DIR))
  {
    if ($file =~ /[^.]/)
    {
      if (-d "$dir/$file")
      {
        rm_rec("$dir/$file");
      }
      else
      {
        unlink("$dir/$file");
      }
    }
  }
  closedir(DIR);

  rmdir($dir);
}

sub cp
{
  my ($fromfile, $tofile, $replace_version) = @_;

  my $text = ($fromfile =~ /\.(manifest|xul|js|xml|xhtml|rdf|dtd|properties|css|h|cpp)$/);
  open(local *FROM, $fromfile) or return;
  open(local *TO, ">$tofile") or return;
  binmode(TO);
  if ($text)
  {
    print TO map {
      s/\r//g;
      s/^((?:  )+)/"\t" x (length($1)\/2)/e;
      s/(\#define\s+ABP_VERSION\s+)"[^"]*"/$1"$version"/ if $replace_version;
      s/(\#define\s+ABP_LANGUAGE\s+)"[^"]*"/$1"$locales[0]"/ if $replace_version;
      s/(\#define\s+ABP_INLINE_SCRIPT\s+)"[^"]*"/$1"$inline_script"/ if $replace_version;
      s/\{\{VERSION\}\}/$version/g if $replace_version;
      s/jar:chrome\//jar:/g if $fromfile =~ /\.manifest$/;
      if ($replace_version && /\{\{LOCALE\}\}/)
      {
        my $loc = "";
        for my $locale (@locales)
        {
          my $tmp = $_;
          $tmp =~ s/\{\{LOCALE\}\}/$locale/g;
          $loc .= $tmp;
        }
        $_ = $loc;
      }
      $_;
    } <FROM>;
  }
  else
  {
    local $/;
    binmode(FROM) unless $text;
    print TO <FROM>;
  }
  close(TO);
  close(FROM);
}

sub cp_rec
{
  my ($fromdir, $todir) = @_;

  my @files;
  if ($fromdir eq "../chrome/locale")
  {
    @files = @locales;
  }
  else
  {
    opendir(local *DIR, $fromdir) or return;
    @files = readdir(DIR);
    closedir(DIR);
  }

  mkdir($todir);
  foreach my $file (@files)
  {
    if ($file =~ /[^.]/ && $file ne 'CVS')
    {
      if (-d "$fromdir/$file")
      {
        cp_rec("$fromdir/$file", "$todir/$file");
      }
      else
      {
        cp("$fromdir/$file", "$todir/$file", $file eq "nsAdblockPlus.js");
      }
    }
  }
}
