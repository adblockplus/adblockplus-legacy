#!/usr/bin/perl

use strict;

open(VERSION, "version");
my $version = <VERSION>;
$version =~ s/[^\w\.]//gs;
close(VERSION);

my $output_file = shift @ARGV || "adblockplus.xpi";

if ($ARGV[0] eq "-dev") {
  $version .= "+";
  shift @ARGV;
}

my @locales;
if (@ARGV)
{
  @locales = @ARGV;
}
else
{
  opendir(LOCALES, "chrome/locale");
  @locales = grep {!/[^\w\-]/ && !/CVS/} readdir(LOCALES);
  closedir(LOCALES);
  
  @locales = sort {$a eq "en-US" ? -1 : ($b eq "en-US" ? 1 : $a cmp $b)} @locales;
}

rm_rec('tmp');
mkdir('tmp');
cp_rec($_, "tmp/$_") foreach ('chrome', 'components', 'defaults');
cp($_, "tmp/$_", 1) foreach ('install.js', 'install.rdf', 'chrome.manifest');
chdir('tmp');

chdir('chrome');
print `zip -0 -X -r adblockplus.jar content skin locale`;
rm_rec($_) foreach ('content', 'skin', 'locale');
chdir('..');

unlink('../$output_file');
print `zip -9 -X -r ../$output_file chrome components defaults install.js install.rdf chrome.manifest`;

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

  my $text = ($fromfile =~ /\.(manifest|xul|js|xml|xhtml|rdf|dtd|properties|css)$/);
  open(local *FROM, $fromfile) or return;
  open(local *TO, ">$tofile") or return;
  binmode(TO);
  if ($text)
  {
    print TO map {
      s/\r//g;
      s/^((?:  )+)/"\t" x (length($1)\/2)/e;
      s/\{\{VERSION\}\}/$version/g if $replace_version;
      if ($replace_version && /\{\{LOCALE\}\}/) {
        my $loc = "";
        for my $locale (@locales) {
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
  if ($fromdir eq "chrome/locale")
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
        cp("$fromdir/$file", "$todir/$file");
      }
    }
  }
}
