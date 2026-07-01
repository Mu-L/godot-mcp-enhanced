class_name TestResource
extends Resource

@export var name: String = ""
@export var damage: int = 0
@export var enabled: bool = true
@export var color: Color = Color.WHITE
@export var kind: int = 0  # 枚举: 0=SWORD, 1=BOW, 2=STAFF(纯 int,无 hint)
# @export_enum 才会填充 hint_string(枚举 hint);CSV→Resource 探测枚举依赖此注解
@export_enum("SWORD", "BOW", "STAFF") var weapon_kind: int = 0
