import bpy
import math
from pathlib import Path

ROOT = Path(r"C:\Users\K\Downloads\plc-wiring-trainer-v3-main")
BLEND = ROOT / "assets" / "models" / "automation" / "palletizer-3axis-v2.blend"
GLB = ROOT / "assets" / "models" / "automation" / "palletizer-3axis-v2.glb"
BLEND.parent.mkdir(parents=True, exist_ok=True)

bpy.ops.object.select_all(action='SELECT')
bpy.ops.object.delete(use_global=False)
for datablocks in (bpy.data.meshes, bpy.data.curves, bpy.data.materials, bpy.data.cameras, bpy.data.lights):
    pass

def mat(name, color, metallic=0.0, roughness=0.45):
    m = bpy.data.materials.new(name)
    m.use_nodes = True
    m.diffuse_color = (*color, 1.0)
    m.metallic = metallic
    m.roughness = roughness
    bsdf = m.node_tree.nodes.get('Principled BSDF')
    bsdf.inputs['Base Color'].default_value = (*color, 1.0)
    bsdf.inputs['Metallic'].default_value = metallic
    bsdf.inputs['Roughness'].default_value = roughness
    return m

ALU = mat('AL6063 anodized', (0.24, 0.29, 0.32), .72, .25)
RAIL = mat('Linear rail polished', (.62, .69, .73), .9, .14)
DARK = mat('Powder coat graphite', (.035, .05, .06), .55, .32)
BLUE = mat('LS industrial blue', (.015, .24, .42), .5, .25)
MOTOR = mat('Servo motor housing', (.14, .18, .21), .45, .28)
STEEL = mat('Machined steel', (.52, .57, .59), .95, .12)
YELLOW = mat('Safety yellow', (.95, .55, .02), .25, .38)
RED = mat('Emergency red', (.72, .025, .018), .28, .35)
RUBBER = mat('Cable rubber', (.012, .016, .019), .1, .52)
WOOD = mat('Pallet wood', (.48, .24, .07), .05, .68)

def empty(name, parent=None, loc=(0,0,0)):
    o = bpy.data.objects.new(name, None); o.empty_display_type='PLAIN_AXES'; o.location=loc
    bpy.context.collection.objects.link(o)
    if parent: o.parent=parent
    return o

def cube(name, size, loc, material, parent=None, bevel=.035):
    bpy.ops.mesh.primitive_cube_add(location=loc)
    o=bpy.context.object; o.name=name; o.scale=(size[0]/2,size[1]/2,size[2]/2)
    bpy.ops.object.transform_apply(location=False, rotation=False, scale=True)
    if bevel:
        mod=o.modifiers.new('Edge chamfer','BEVEL'); mod.width=bevel; mod.segments=2
    o.data.materials.append(material)
    if parent: o.parent=parent
    return o

def cyl(name, radius, depth, loc, material, parent=None, axis='Y', vertices=24):
    rot=(math.pi/2,0,0) if axis=='Y' else ((0,math.pi/2,0) if axis=='X' else (0,0,0))
    bpy.ops.mesh.primitive_cylinder_add(vertices=vertices, radius=radius, depth=depth, location=loc, rotation=rot)
    o=bpy.context.object; o.name=name; o.data.materials.append(material)
    if parent:o.parent=parent
    return o

def extrusion(name, size, loc, parent=None):
    g=empty(name,parent,loc)
    cube(name+'_Body',size,(0,0,0),ALU,g,.025)
    axis=max(range(3),key=lambda i:size[i])
    groove=.025
    if axis==0:
        for y in (-size[1]*.39,size[1]*.39):
            for z in (-size[2]*.39,size[2]*.39):cube(name+'_TSlot',(size[0]*.96,groove,groove),(0,y,z),DARK,g,.005)
    elif axis==1:
        for x in (-size[0]*.39,size[0]*.39):
            for z in (-size[2]*.39,size[2]*.39):cube(name+'_TSlot',(groove,size[1]*.96,groove),(x,0,z),DARK,g,.005)
    else:
        for x in (-size[0]*.39,size[0]*.39):
            for y in (-size[1]*.39,size[1]*.39):cube(name+'_TSlot',(groove,groove,size[2]*.96),(x,y,0),DARK,g,.005)
    return g

def servo(name, loc, parent=None, axis='X'):
    g=empty(name,parent,loc)
    cube(name+'_Housing',(.68,.68,.68),(0,0,0),MOTOR,g,.075)
    cube(name+'_RearCap',(.55,.55,.16),(0,0,-.4),BLUE,g,.04)
    cube(name+'_Connector',(.31,.24,.18),(.18,.31,-.36),DARK,g,.025)
    cyl(name+'_Shaft',.105,.32,(0,0,.49),STEEL,g,'Z')
    for x in (-.25,.25):
        for y in (-.25,.25):cyl(name+'_Bolt',.035,.03,(x,y,.355),STEEL,g,'Z',16)
    if axis=='X':g.rotation_euler[1]=math.pi/2
    elif axis=='Y':g.rotation_euler[0]=math.pi/2
    return g

def chain(name, start, end, count, parent=None):
    g=empty(name,parent)
    for i in range(count):
        t=i/(count-1); p=tuple(start[j]+(end[j]-start[j])*t for j in range(3))
        link=cube(f'{name}_Link_{i:02}',(.24,.13,.31),p,RUBBER,g,.035)
        cube(f'{name}_Open_{i:02}',(.11,.15,.16),p,DARK,g,.015)
    return g

root=empty('PALLETIZER_ROOT')
cube('Machine_Base',(10.9,.32,6.7),(0,.3,0),DARK,root,.08)
for x in (-5.0,5.0):
    for z in (-2.9,2.9):
        extrusion(f'Foot_{x}_{z}',(.42,1.05,.42),(x,-.28,z),root)
for x in (-5.0,5.0): extrusion(f'Column_{x}',(.45,5.05,.45),(x,2.75,2.72),root)
extrusion('X_Beam',(10.45,.52,.58),(0,5.13,2.72),root)
for y in (4.72,4.91):cube('X_LinearRail',(9.8,.09,.14),(0,y,2.43),RAIL,root,.015)
cube('X_BallScrew_Cover',(9.75,.17,.15),(0,5.02,2.39),DARK,root,.02)
cyl('X_BallScrew',.052,9.35,(0,4.99,2.31),STEEL,root,'X')
servo('X_Servo',(-5.27,5.14,2.72),root,'X')
cyl('X_Coupling',.14,.36,(-4.75,5.14,2.72),BLUE,root,'X')
chain('X_EnergyChain',(-4.25,5.52,2.2),(3.8,5.52,2.2),24,root)

xcar=empty('X_Carriage',root)
cube('X_CarriagePlate',(.98,.76,1.02),(0,4.82,2.64),BLUE,xcar,.07)
for x in (-.27,.27):
    for z in (2.35,2.82):cube('X_RailBlock',(.28,.18,.34),(x,4.68,z),RAIL,xcar,.025)
extrusion('Y_Beam',(.48,.5,5.85),(0,4.62,0),xcar)
for x in (-.17,.17):cube('Y_LinearRail',(.095,.13,5.45),(x,4.29,0),RAIL,xcar,.014)
cyl('Y_BallScrew',.052,5.22,(0,4.34,0),STEEL,xcar,'Z')
servo('Y_Servo',(0,4.64,3.18),xcar,'Y')
chain('Y_EnergyChain',(.39,4.73,2.2),(.39,4.73,-2.2),18,xcar)

ycar=empty('Y_Carriage',xcar)
cube('Y_CarriagePlate',(.98,.62,.94),(0,4.3,0),BLUE,ycar,.065)
for x in (-.24,.24):
    for z in (-.25,.25):cube('Y_RailBlock',(.25,.17,.28),(x,4.24,z),RAIL,ycar,.022)
extrusion('Z_Mast',(.46,4.4,.46),(0,2.33,0),ycar)
for x in (-.18,.18):cube('Z_LinearRail',(.08,4.0,.12),(x,2.36,.27),RAIL,ycar,.012)
cyl('Z_BallScrew',.048,3.78,(0,2.36,.34),STEEL,ycar,'Y')
servo('Z_Servo',(0,4.14,.06),ycar,'Y')
chain('Z_EnergyChain',(-.36,3.9,-.24),(-.36,.92,-.24),14,ycar)

zslide=empty('Z_Slide',ycar)
cube('Z_CarriagePlate',(.9,.68,.82),(0,0,0),BLUE,zslide,.065)
for x in (-.24,.24):cube('Z_RailBlock',(.25,.24,.28),(x,.18,.22),RAIL,zslide,.022)
grip=empty('Gripper',zslide,(0,-.34,0))
cyl('Gripper_Rotator',.22,.38,(0,-.05,0),MOTOR,grip,'Y')
cube('Gripper_CrossPlate',(.96,.18,.68),(0,-.28,0),DARK,grip,.045)
cube('Gripper_Slide',(.7,.16,.46),(0,-.42,0),BLUE,grip,.035)
for x in (-.27,.27):cube('Jaw_Guide',(.16,.12,.38),(x,-.54,0),RAIL,grip,.018)
jawl=empty('Jaw_L',grip,(-.31,0,0)); jawr=empty('Jaw_R',grip,(.31,0,0))
cube('Jaw_L_Finger',(.13,.7,.21),(0,-.84,0),STEEL,jawl,.025)
cube('Jaw_R_Finger',(.13,.7,.21),(0,-.84,0),STEEL,jawr,.025)
cube('Jaw_L_Pad',(.19,.14,.31),(.04,-1.14,0),RUBBER,jawl,.02)
cube('Jaw_R_Pad',(.19,.14,.31),(-.04,-1.14,0),RUBBER,jawr,.02)

# pallet and pick fixture give the cell realistic scale without classroom props
for i in range(-2,3):cube('Pallet_Slat',(2.4,.11,.34),(2.7,.52,-1.45+i*.38),WOOD,root,.025)
for z in (-2.05,-.85):cube('Pallet_Block',(2.25,.18,.18),(2.7,.39,z),WOOD,root,.02)
cube('Pick_Fixture',(1.25,.18,1.08),(-3.15,.48,-1.7),DARK,root,.04)
for x in (-3.58,-2.72):
    for z in (-2.05,-1.35):cyl('Locator_Pin',.06,.22,(x,.66,z),YELLOW,root,'Y',16)

# safety posts and compact LS-style control cabinet
for x,z in ((-5.35,-3.15),(-5.35,3.15),(5.35,-3.15),(5.35,3.15)):
    extrusion('Safety_Post',(.17,2.7,.17),(x,1.8,z),root)
    cube('Safety_Foot',(.34,.1,.34),(x,.45,z),YELLOW,root,.03)
cab=empty('LS_Control_Cabinet',root,(4.55,0,-2.53))
cube('Cabinet',(1.3,2.42,.76),(0,1.64,0),ALU,cab,.06)
cube('Cabinet_Door',(1.16,2.18,.05),(0,1.64,.405),DARK,cab,.025)
cyl('Emergency_Stop',.11,.13,(-.37,2.2,.45),RED,cab,'Z')
for y,m in ((3.34,RED),(3.15,YELLOW),(2.96,BLUE)):cyl('Tower_Lamp',.115,.17,(.42,y,0),m,cab,'Y')

# Authoring helpers use the application's Y-up coordinates. Rotate the complete
# hierarchy into Blender Z-up; Blender's glTF exporter converts it back to Y-up.
root.rotation_euler[0]=math.pi/2

# presentation camera and studio lights for the editable .blend
preview_target=empty('Preview_Target',None,(0,0,2.45))
bpy.ops.object.camera_add(location=(13,-15,10.5))
camera=bpy.context.object; camera.name='Preview_Camera'; camera.data.lens=52; bpy.context.scene.camera=camera
constraint=camera.constraints.new(type='TRACK_TO'); constraint.target=preview_target; constraint.track_axis='TRACK_NEGATIVE_Z'; constraint.up_axis='UP_Y'
for loc,energy,size in (((-7,-8,13),750,6),((9,-5,7),500,5),((0,7,11),420,4)):
    bpy.ops.object.light_add(type='AREA', location=loc); light=bpy.context.object; light.data.energy=energy; light.data.shape='DISK'; light.data.size=size
    c=light.constraints.new(type='TRACK_TO'); c.target=preview_target; c.track_axis='TRACK_NEGATIVE_Z'; c.up_axis='UP_Y'

scene=bpy.context.scene
scene.render.engine='BLENDER_EEVEE'
scene.render.resolution_x=1280; scene.render.resolution_y=720; scene.render.resolution_percentage=100
scene.render.image_settings.file_format='PNG'
scene.render.filepath=str(ROOT/'artifacts'/'palletizer-3axis-v2-preview.png')
scene.world.color=(.018,.025,.032)
scene.view_settings.look='AgX - Medium High Contrast'

bpy.ops.wm.save_as_mainfile(filepath=str(BLEND))
bpy.ops.export_scene.gltf(filepath=str(GLB), export_format='GLB', use_visible=True, export_apply=True, export_yup=True)
bpy.ops.render.render(write_still=True)
print(f'PALLETIZER_EXPORT_OK blend={BLEND} glb={GLB}')
