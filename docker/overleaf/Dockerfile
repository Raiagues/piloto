FROM sharelatex/sharelatex:6.3.2

# Packages used by Norte's LaTeX export (tables and colors). tlmgr can report a failed
# download and still exit 0, so the build checks that the files are really installed.
RUN tlmgr option repository https://mirror.ctan.org/systems/texlive/tlnet \
    && tlmgr update --self \
    && tlmgr install booktabs xcolor \
    && tlmgr path add \
    && kpsewhich booktabs.sty xcolor.sty
